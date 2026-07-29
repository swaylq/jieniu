// 单测夹具：往 stderr 写错因并以非 0 退出。
console.error("[fixture] 故意失败");
process.exitCode = 1;
