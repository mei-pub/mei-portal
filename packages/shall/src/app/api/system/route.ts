import { NextResponse } from 'next/server';
import os from 'node:os';

export const dynamic = 'force-dynamic';

// GET /api/system — 系统监控（复刻 Sun-Panel 系统监控状态）
export async function GET() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return NextResponse.json({
    uptime: os.uptime(),
    cpuCount: os.cpus().length,
    loadavg: os.loadavg().map((n) => Number(n.toFixed(2))),
    memory: {
      total: Math.round(total / 1024 / 1024),
      used: Math.round(used / 1024 / 1024),
      free: Math.round(free / 1024 / 1024),
      percent: total ? Math.round((used / total) * 100) : 0,
    },
    platform: `${os.type()} ${os.release()}`,
    hostname: os.hostname(),
  });
}
