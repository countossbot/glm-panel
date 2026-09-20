"use client";

// src/components/admin/overview-tab.tsx

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { AdminStatus, WatchdogInfo } from "./types";
import { Copy, Check, Power, RotateCw, Square, Play, BatteryCharging } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};
const getClientBaseUrl = () => `${window.location.origin}/v1`;
const getServerBaseUrl = () => "/v1";

function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-400"
      : tone === "warn"
        ? "text-amber-400"
        : tone === "bad"
          ? "text-red-400"
          : "text-zinc-100";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 truncate text-lg font-semibold ${toneCls}`}>{value}</p>
      {sub ? <p className="mt-0.5 truncate text-xs text-zinc-500">{sub}</p> : null}
    </div>
  );
}

function AutoRefillCard({
  watchdog,
  pool,
  onAction,
  pending,
}: {
  watchdog: WatchdogInfo | null;
  pool: number | null;
  onAction: (action: "start" | "stop") => void;
  pending: string | null;
}) {
  const on = watchdog?.running ?? false;
  const refilling = on && (watchdog?.collectorRunning ?? false);
  return (
    <Card className="border-zinc-800 bg-zinc-900/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2 text-zinc-200">
            <BatteryCharging
              className={`h-4 w-4 ${refilling ? "animate-pulse text-amber-300" : on ? "text-emerald-400" : "text-zinc-500"}`}
            />
            CAPTCHA 令牌池自动补充
          </span>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={
                refilling
                  ? "border-amber-700 text-amber-300"
                  : on
                    ? "border-emerald-800 text-emerald-400"
                    : "border-zinc-700 text-zinc-400"
              }
            >
              {refilling ? "补充中…" : on ? "已启用" : "关闭"}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              disabled={pending !== null}
              onClick={() => onAction(on ? "stop" : "start")}
              className={
                on
                  ? "border-zinc-700 bg-transparent hover:bg-zinc-800 hover:text-red-300"
                  : "border-zinc-700 bg-transparent hover:bg-zinc-800 hover:text-emerald-300"
              }
            >
              {on ? <Square className="mr-1 h-3.5 w-3.5" /> : <Play className="mr-1 h-3.5 w-3.5" />}
              {pending !== null ? "…" : on ? "关闭" : "启用"}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-zinc-400">
        <p>
          看门狗进程每 2 分钟检查一次设备令牌池。当令牌数量低于
          100 时会运行{" "}
          <span className="font-mono text-zinc-300">token-collector --topup</span> 进行补充，恢复
          最多补充到 150 个。新令牌会写入 Bridge 使用的实时数据库，因此
          可立即使用（无需重启、不会清空数据，补充期间聊天仍可正常工作）。
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <span>
            <span className="text-zinc-500">监控：</span>{" "}
            <span className="font-mono text-zinc-300">
              {on ? `运行中 · pid ${watchdog?.pid}` : "已停止"}
            </span>
          </span>
          <span>
            <span className="text-zinc-500">当前令牌池：</span>{" "}
            <span className="font-mono text-zinc-300">{pool !== null ? `${pool} 剩余` : "—"}</span>
          </span>
          {watchdog?.lastRefill ? (
            <span className="font-mono text-emerald-400/80">{watchdog.lastRefill}</span>
          ) : watchdog?.lastLine ? (
            <span className="font-mono text-zinc-500">{watchdog.lastLine}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function OverviewTab({
  status,
  onAction,
  actionPending,
  onWatchdogAction,
  watchdogPending,
}: {
  status: AdminStatus | null;
  onAction: (action: "start" | "stop" | "restart") => void;
  actionPending: string | null;
  onWatchdogAction: (action: "start" | "stop") => void;
  watchdogPending: string | null;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  // SSR-safe origin: server & hydration snapshot render "/v1", then the client
  // re-renders with the real origin — no hydration mismatch, no setState-in-effect.
  const baseUrl = useSyncExternalStore(
    subscribeNoop,
    getClientBaseUrl,
    getServerBaseUrl
  );
  const running = status?.process.running ?? false;
  const healthy = status?.health.healthy ?? false;
  const zai = status?.zai ?? null;
  const pool = zai?.sessionPool;
  const auth = status?.auth ?? null;
  const authKeySet = auth?.mode === "key";

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const curl = `curl -X POST ${baseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\${authKeySet ? `
  -H "Authorization: Bearer ${auth?.key}" \\` : ""}
  -d '{"model":"glm-4.7","stream":false,"messages":[{"role":"user","content":"Hello!"}]}'`;

  return (
    <div className="space-y-4">
      {/* Control bar */}
      <Card className="border-zinc-800 bg-zinc-900/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
            <span className="text-zinc-200">后端服务控制</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={running || actionPending !== null}
                onClick={() => onAction("start")}
                className="border-zinc-700 bg-transparent hover:bg-zinc-800 hover:text-emerald-300"
              >
                <Play className="mr-1 h-3.5 w-3.5" /> 启动
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!running || actionPending !== null}
                onClick={() => onAction("restart")}
                className="border-zinc-700 bg-transparent hover:bg-zinc-800 hover:text-amber-300"
              >
                <RotateCw className={`mr-1 h-3.5 w-3.5 ${actionPending === "restart" ? "animate-spin" : ""}`} />
                重启
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!running || actionPending !== null}
                onClick={() => onAction("stop")}
                className="border-zinc-700 bg-transparent hover:bg-zinc-800 hover:text-red-300"
              >
                <Square className="mr-1 h-3.5 w-3.5" /> 停止
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="后台进程"
              value={running ? `PID ${status?.process.pid}` : "已停止"}
              tone={running ? "good" : "bad"}
              sub={running ? "持久运行的子进程" : "启动后提供 /v1 服务"}
            />
            <Stat
              label="健康状态"
              value={healthy ? "正常" : running ? "初始化中" : "—"}
              tone={healthy ? "good" : running ? "warn" : "bad"}
              sub={`模式：${String((status?.health.body as { mode?: string })?.mode ?? "n/a")}`}
            />
            <Stat
              label="Z.AI 会话"
              value={zai?.connected ? "已连接" : "—"}
              tone={zai?.connected ? "good" : "default"}
              sub={zai?.userName ?? undefined}
            />
            <Stat
              label="会话池"
              value={pool ? `${pool.ready ?? "?"}/${pool.size ?? "?"} 就绪` : "—"}
              sub={
                pool
                  ? `${pool.mode ?? "?"} · 临时会话： ${pool.throwaway ? "开启" : "关闭"} · 垃圾回收： ${pool.gc_enabled ? "开启" : "关闭"}`
                  : undefined
              }
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="CAPTCHA 令牌池"
              value={status?.tokenPool !== null && status?.tokenPool !== undefined ? `${status.tokenPool} 剩余` : "—"}
              tone={
                status?.tokenPool === null || status?.tokenPool === undefined
                  ? "default"
                  : status.tokenPool > 20
                    ? "good"
                    : status.tokenPool > 5
                      ? "warn"
                      : "bad"
              }
              sub={
                status?.watchdog?.running
                  ? "每次请求消耗 1 个 · 已启用自动补充"
                  : "每次聊天请求消耗 1 个 · 不自动补充"
              }
            />
            <Stat
              label="客户端认证令牌"
              value={authKeySet ? auth?.masked ?? "已设置" : "开放——任意密钥"}
              tone={authKeySet ? "good" : "warn"}
              sub={authKeySet ? "需要提供 · Bearer / x-api-key" : "无需密钥——请在“ZAI 令牌”页设置"}
            />
            <Stat
              label="ZAI_TOKEN"
              value={status?.token.mode === "token" ? "已设置" : "访客"}
              tone={status?.token.mode === "token" ? "good" : "warn"}
              sub={status?.token.masked ?? "匿名——仅支持 glm-4.7 / 5.3-flash"}
            />
            <Stat label="上游" value="chat.z.ai" sub="非官方 /api/v2/chat/completions" />
          </div>
        </CardContent>
      </Card>

      {/* CAPTCHA 令牌池自动补充 */}
      <AutoRefillCard
        watchdog={status?.watchdog ?? null}
        pool={status?.tokenPool ?? null}
        onAction={onWatchdogAction}
        pending={watchdogPending}
      />

      {/* Endpoints */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-zinc-200">本面板通过 /v1 提供后端接口</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-zinc-400">
              GLM Bridge 可通过本面板自己的 URL 访问——请将任何兼容 OpenAI 的
              工具指向下面的基础 URL。
            </p>
            <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs">
              <span className="flex-1 truncate text-emerald-300">{baseUrl}</span>
              <button
                aria-label="复制基础 URL"
                className="text-zinc-500 hover:text-zinc-200"
                onClick={() => copy(baseUrl, "url")}
              >
                {copied === "url" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <Separator className="bg-zinc-800" />
            <div className="space-y-1.5 text-xs text-zinc-400">
              <p><span className="font-mono text-zinc-300">POST /v1/chat/completions</span> — OpenAI 聊天（流式 + 非流式）</p>
              <p><span className="font-mono text-zinc-300">POST /v1/messages</span> — Anthropic Messages API</p>
              <p><span className="font-mono text-zinc-300">GET&nbsp; /v1/models</span> — 实时模型目录</p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="outline" className="border-zinc-700 text-zinc-300">认证</Badge>
              <span className="font-mono text-zinc-400">
                {authKeySet ? `Bearer ${auth?.masked}` : "开放——接受任意密钥或不提供密钥"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-zinc-200">快速测试（通过本面板的 /v1）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="max-h-56 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
{curl}
            </pre>
            <button
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200"
              onClick={() => copy(curl, "curl")}
            >
              {copied === "curl" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              复制 cURL 命令
            </button>
          </CardContent>
        </Card>
      </div>

      {/* 运行时信息 */}
      <Card className="border-zinc-800 bg-zinc-900/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-zinc-200">运行时信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-4">
            <div><p className="text-zinc-500">Agent 模式</p><p className="mt-0.5 font-mono text-zinc-200">{status?.config.agentMode ? "modern shim" : "关闭"}</p></div>
            <div><p className="text-zinc-500">前端版本</p><p className="mt-0.5 font-mono text-zinc-200">{zai?.feVersion ?? "—"}</p></div>
            <div><p className="text-zinc-500">用户 ID</p><p className="mt-0.5 truncate font-mono text-zinc-200">{zai?.userId ?? "—"}</p></div>
            <div><p className="text-zinc-500">上游模式</p><p className="mt-0.5 font-mono text-zinc-200">{zai?.mode ?? "—"}</p></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
