"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";
import { AVATAR_GRADIENTS } from "~/lib/brand";
import {
  AVATAR_CHAR_MAX,
  cropSourceRect,
  normalizeAvatarChar,
  resolveAvatar,
  type AvatarPrefs,
} from "~/lib/avatar";
import { UserAvatar } from "./user-avatar";
import { brandBtn, fieldCls } from "./section-head";

/** 取景框边长（CSS px）。预览与出图共用这个数，所见即所存。 */
const VIEWPORT = 260;
/** 出图边长。服务端还会再压到 256——这里给 2× 余量，缩小永远比放大好看。 */
const OUTPUT = 512;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ZOOM = 4;

const cardCls = "rounded-xl border border-line bg-surface p-4";
const ghostBtn =
  "rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-60";

type Photo = { src: string; w: number; h: number };

/**
 * 头像编辑器：上传照片（圆形取景裁剪）/ 文字头像（选色 + 自定义字）/ 恢复默认。
 *
 * 独立成一页而不是弹层：裁剪交互体积不小，独立页省掉焦点陷阱、滚动锁、返回键那一堆无障碍活儿。
 *
 * 缩放用**滑块**不用双指捏合：桌面移动同一套代码，绕开触屏手势的一堆边界情况
 * （这类交互 bug 只有真人上手才暴露）。拖动定位走 pointer events + `setPointerCapture`，
 * 鼠标 / 触屏 / 触控笔通吃。
 */
export function AvatarEditor({
  initial,
  seed,
}: {
  initial: AvatarPrefs;
  seed: string | null;
}) {
  const router = useRouter();

  // 待编辑的照片（还没保存）。null = 没选图，只显示「选择图片」按钮。
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [zoom, setZoom] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  // 文字头像的待保存值。初值取库里已存的，改完点「用这个」才落库。
  const [color, setColor] = useState<number | null>(initial.avatarColor ?? null);
  const [char, setChar] = useState(initial.avatarChar ?? "");

  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{
    id: number;
    x: number;
    y: number;
    tx: number;
    ty: number;
  } | null>(null);

  const setAvatar = api.account.setAvatar.useMutation({
    onSuccess: (_res, vars) => {
      setErr(null);
      setOk(
        vars.kind === "image"
          ? "头像已更新"
          : vars.kind === "preset"
            ? "文字头像已保存"
            : "已恢复默认头像",
      );
      setPhoto(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    },
    onError: (e) => {
      setOk(null);
      setErr(e.message);
    },
  });

  const saved = resolveAvatar(initial, seed);
  const hasCustom =
    !!initial.image || initial.avatarColor !== null || initial.avatarChar !== null;
  // 文字头像的实时预览：把待保存的色 / 字丢进同一个判定函数，保证预览与保存后一模一样。
  const preview = resolveAvatar(
    { image: null, avatarColor: color, avatarChar: normalizeAvatarChar(char) },
    seed,
  );

  /** 图在取景框里的显示缩放：zoom=1 恰好填满（cover）。 */
  const scale = photo ? (VIEWPORT / Math.min(photo.w, photo.h)) * zoom : 1;
  const maxTx = photo ? Math.max(0, (photo.w * scale - VIEWPORT) / 2) : 0;
  const maxTy = photo ? Math.max(0, (photo.h * scale - VIEWPORT) / 2) : 0;

  function pickFile(file: File | undefined) {
    setErr(null);
    setOk(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setErr("图片超过 20 MB，换一张小点的");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setErr("文件读取失败，再试一次");
    reader.onload = () => {
      // readAsDataURL 一定给 string；类型上仍可能是 ArrayBuffer，别硬转（会得到 [object …]）。
      const src = typeof reader.result === "string" ? reader.result : "";
      if (!src) {
        setErr("文件读取失败，再试一次");
        return;
      }
      const probe = new Image();
      probe.onload = () => {
        setPhoto({ src, w: probe.naturalWidth, h: probe.naturalHeight });
        setZoom(1);
        setTx(0);
        setTy(0);
      };
      // iPhone 的 HEIC 原图浏览器解不了——这里是唯一能拦住它的地方，提示要说人话。
      probe.onerror = () =>
        setErr("这张图浏览器读不出来（iPhone 的 HEIC 原图就是这样）。导出成 JPG 再试。");
      probe.src = src;
    };
    reader.readAsDataURL(file);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!photo) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, tx, ty };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    if (d.id !== e.pointerId) return;
    setTx(clamp(d.tx + (e.clientX - d.x), -maxTx, maxTx));
    setTy(clamp(d.ty + (e.clientY - d.y), -maxTy, maxTy));
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function onZoom(next: number) {
    if (!photo) return;
    const s = (VIEWPORT / Math.min(photo.w, photo.h)) * next;
    const mx = Math.max(0, (photo.w * s - VIEWPORT) / 2);
    const my = Math.max(0, (photo.h * s - VIEWPORT) / 2);
    setZoom(next);
    // 缩小后原来的平移可能把图拉出框外，跟着夹一次。
    setTx((v) => clamp(v, -mx, mx));
    setTy((v) => clamp(v, -my, my));
  }

  function savePhoto() {
    const el = imgRef.current;
    if (!photo || !el) return;
    const rect = cropSourceRect({
      naturalW: photo.w,
      naturalH: photo.h,
      viewport: VIEWPORT,
      zoom,
      tx,
      ty,
    });
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setErr("浏览器不支持画布裁剪，换个浏览器试试");
      return;
    }
    ctx.drawImage(el, rect.sx, rect.sy, rect.size, rect.size, 0, 0, OUTPUT, OUTPUT);
    // 不支持 webp 的浏览器会静默回落成 PNG——服务端按魔数放行，两种都收。
    setAvatar.mutate({ kind: "image", dataUrl: canvas.toDataURL("image/webp", 0.92) });
  }

  return (
    <div className="space-y-4">
      <div className={`${cardCls} flex items-center gap-4`}>
        <UserAvatar seed={seed} avatar={saved} className="h-16 w-16 text-2xl" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">当前头像</p>
          <p className="mt-0.5 text-xs text-muted">
            {initial.image
              ? "自己上传的照片"
              : hasCustom
                ? "文字头像"
                : "默认头像 · 按邮箱取色"}
          </p>
        </div>
      </div>

      <section className={cardCls}>
        <h2 className="text-sm font-bold text-ink">上传照片</h2>
        <p className="mt-0.5 text-xs text-muted">
          支持 JPG / PNG / WebP，会裁成正方形存成 256×256
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />

        {photo ? (
          <div className="mt-3.5 flex flex-col items-center gap-3">
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={{ width: VIEWPORT, height: VIEWPORT }}
              className="relative max-w-full cursor-grab touch-none overflow-hidden rounded-full border border-line bg-canvas active:cursor-grabbing"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={photo.src}
                alt="待裁剪的头像"
                draggable={false}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: photo.w * scale,
                  height: photo.h * scale,
                  maxWidth: "none",
                  transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px)`,
                }}
              />
            </div>
            <label className="flex w-full max-w-[260px] items-center gap-2 text-xs text-muted">
              缩放
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={(e) => onZoom(Number(e.target.value))}
                className="flex-1 accent-brand"
                aria-label="缩放"
              />
            </label>
            <p className="text-xs text-muted">拖动圆框里的图片调整位置</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={savePhoto}
                disabled={setAvatar.isPending}
                className={brandBtn}
              >
                {setAvatar.isPending ? "保存中…" : "保存这张"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPhoto(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className={ghostBtn}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`${ghostBtn} mt-3`}
          >
            选择图片
          </button>
        )}
      </section>

      <section className={cardCls}>
        <h2 className="text-sm font-bold text-ink">文字头像</h2>
        <p className="mt-0.5 text-xs text-muted">
          不想放照片就用这个：挑个底色，写一两个字
        </p>

        <div className="mt-3.5 flex items-center gap-4">
          <UserAvatar seed={seed} avatar={preview} className="h-14 w-14 text-xl" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap gap-2">
              {AVATAR_GRADIENTS.map(([from, to], i) => (
                <button
                  key={from}
                  type="button"
                  aria-label={`底色 ${i + 1}`}
                  aria-pressed={color === i}
                  onClick={() => setColor(color === i ? null : i)}
                  style={{ backgroundImage: `linear-gradient(140deg, ${from}, ${to})` }}
                  className={`h-8 w-8 rounded-full transition-transform hover:scale-110 ${
                    color === i
                      ? "ring-2 ring-brand ring-offset-2 ring-offset-surface"
                      : "ring-1 ring-white/15"
                  }`}
                />
              ))}
            </div>
            <input
              type="text"
              value={char}
              onChange={(e) => setChar(e.target.value)}
              maxLength={16}
              placeholder={`显示的字（最多 ${AVATAR_CHAR_MAX} 个，留空用邮箱首字母）`}
              className={fieldCls}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            setAvatar.mutate({
              kind: "preset",
              color,
              char: normalizeAvatarChar(char),
            })
          }
          disabled={setAvatar.isPending}
          className={`${brandBtn} mt-3.5`}
        >
          {initial.image ? "用这个（会取消照片）" : "用这个"}
        </button>
      </section>

      {hasCustom ? (
        /* 移动端竖排：横排时「恢复默认」按钮正好落在右下角浮动的「问解牛」底下，点不着。 */
        <section
          className={`${cardCls} flex flex-col items-start gap-3 sm:flex-row sm:items-center`}
        >
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-ink">恢复默认</h2>
            <p className="mt-0.5 text-xs text-muted">
              删掉照片与自定义设置，回到按邮箱取色的默认头像
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setColor(null);
              setChar("");
              setAvatar.mutate({ kind: "reset" });
            }}
            disabled={setAvatar.isPending}
            className={ghostBtn}
          >
            恢复默认
          </button>
        </section>
      ) : null}

      {err ? (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {err}
        </p>
      ) : null}
      {ok ? (
        <p className="rounded-lg bg-brand/10 px-3 py-2 text-xs text-brand-dark dark:text-brand">
          {ok}
        </p>
      ) : null}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
