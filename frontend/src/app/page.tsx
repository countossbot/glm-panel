"use client";

// src/app/page.tsx — GLM Bridge Admin Panel

import { useCallback, useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { OverviewTab } from "@/components/admin/overview-tab";
import { ModelsTab } from "@/components/admin/models-tab";
import { TokenTab } from "@/components/admin/token-tab";
import { LogsTab } from "@/components/admin/logs-tab";
import { PlaygroundTab } from "@/components/admin/playground-tab";
import type { AdminStatus, ModelInfo, TokenState } from "@/components/admin/types";
import type { AuthKeyStateView } from "@/components/admin/token-tab";
import { Activity, KeyRound, ListTree, ScrollText, FlaskConical } from "lucide-react";

export default function AdminPage() {
  const { toast } = useToast();

  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [tokenState, setTokenState] = useState<TokenState | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [agentMode, setAgentMode] = useState(true);
  const [savingToken, setSavingToken] = useState(false);

  const [logLines, setLogLines] = useState<string[]>([]);
  const [logsAuto, setLogsAuto] = useState(true);

  const [playModel, setPlayModel] = useState("glm-4.7");
  const [playPrompt, setPlayPrompt] = useState("");
  const [playResponse, setPlayResponse] = useState("");
  const [playLoading, setPlayLoading] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);

  const [actionPending, setActionPending] = useState<string | null>(null);
  const [watchdogPending, setWatchdogPending] = useState<string | null>(null);

  const [authKeyInput, setAuthKeyInput] = useState("");
  const [savingAuthKey, setSavingAuthKey] = useState(false);

  const statusTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------- data fetchers ----------

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/status", { cache: "no-store" });
      const data: AdminStatus = await res.json();
      setStatus(data);
      setAgentMode(data.config.agentMode);
    } catch {
      /* keep last known */
    }
  }, []);

  const refreshModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await fetch("/api/admin/models", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setModels(data.models);
      } else {
        setModelsError(data.error ?? "failed to load models");
      }
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const refreshLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/logs?lines=200", { cache: "no-store" });
      const data = await res.json();
      setLogLines(data.lines ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshTokenState = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/token", { cache: "no-store" });
      setTokenState(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  // ---------- effects ----------

  useEffect(() => {
    refreshStatus();
    refreshModels();
    refreshTokenState();
    refreshLogs();
    statusTimer.current = setInterval(refreshStatus, 5000);
    return () => {
      if (statusTimer.current) clearInterval(statusTimer.current);
    };
  }, [refreshStatus, refreshModels, refreshTokenState, refreshLogs]);

  useEffect(() => {
    if (logsAuto) {
      refreshLogs();
      logsTimer.current = setInterval(refreshLogs, 3000);
    } else if (logsTimer.current) {
      clearInterval(logsTimer.current);
      logsTimer.current = null;
    }
    return () => {
      if (logsTimer.current) clearInterval(logsTimer.current);
    };
  }, [logsAuto, refreshLogs]);

  // ---------- actions ----------

  const handleAction = async (action: "start" | "stop" | "restart") => {
    setActionPending(action);
    try {
      const res = await fetch("/api/admin/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.ok) {
        toast({
          title: action === "start" ? "后端已启动" : action === "stop" ? "后端已停止" : "后端已重启",
          description: data.pid ? `PID ${data.pid}` : undefined,
        });
        if (action !== "stop" && Array.isArray(data.models) && data.models.length > 0) {
          setModels(data.models);
        }
      } else {
        toast({ title: action === "start" ? "启动失败" : "停止失败", description: data.error, variant: "destructive" });
      }
    } catch (e) {
      toast({
        title: action === "start" ? "启动失败" : action === "stop" ? "停止失败" : "重启失败",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setActionPending(null);
      refreshStatus();
      refreshModels();
    }
  };

  const handleWatchdog = async (action: "start" | "stop") => {
    setWatchdogPending(action);
    try {
      const res = await fetch("/api/admin/watchdog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.ok) {
        toast({
          title: action === "start" ? "自动补充已启用" : "自动补充已关闭",
          description:
            action === "start"
              ? "令牌池不足时将自动补充"
              : "看门狗后台进程已停止",
        });
      } else {
        toast({ title: action === "start" ? "启动失败" : "停止失败", description: data.error, variant: "destructive" });
      }
    } catch (e) {
      toast({
        title: action === "start" ? "启动失败" : action === "stop" ? "停止失败" : "重启失败",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setWatchdogPending(null);
      refreshStatus();
    }
  };

  const handleSaveToken = async () => {
    setSavingToken(true);
    try {
      const res = await fetch("/api/admin/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zaiToken: tokenInput.trim(), agentMode }),
      });
      const data = await res.json();
      if (data.ok) {
        setTokenInput("");
        setTokenState({ mode: data.mode, masked: data.masked, length: data.length });
        if (Array.isArray(data.models) && data.models.length > 0) {
          setModels(data.models);
        }
        toast({
          title: data.mode === "token" ? "令牌已保存——登录会话已激活" : "已保存——访客会话已激活",
          description:
            Array.isArray(data.models) && data.models.length > 0
              ? `${data.models.length} models available now`
              : data.modelsError ?? undefined,
        });
      } else {
        toast({ title: "保存失败", description: data.error, variant: "destructive" });
      }
    } catch (e) {
      toast({
        title: "保存失败",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSavingToken(false);
      refreshStatus();
      refreshModels();
    }
  };

  const handleSaveAuthKey = async () => {
    setSavingAuthKey(true);
    try {
      const res = await fetch("/api/admin/authkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authKey: authKeyInput.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        const state = data as AuthKeyStateView & { ok: boolean };
        setAuthKeyInput("");
        toast({
          title: state.mode === "key" ? "客户端认证密钥已保存——之后必须提供密钥" : "认证已关闭——开放访问",
          description:
            state.mode === "key"
              ? "客户端必须通过 Bearer / x-api-key 发送此密钥"
              : "/v1 接受任意密钥或不提供密钥",
        });
      } else {
        toast({ title: "保存失败", description: data.error, variant: "destructive" });
      }
    } catch (e) {
      toast({
        title: "保存失败",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSavingAuthKey(false);
      refreshStatus();
    }
  };

  const handlePlaySend = async () => {
    setPlayLoading(true);
    setPlayError(null);
    setPlayResponse("");
    try {
      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(status?.auth?.mode === "key" && status.auth.key
            ? { Authorization: `Bearer ${status.auth.key}` }
            : {}),
        },
        body: JSON.stringify({
          model: playModel,
          stream: false,
          messages: [{ role: "user", content: playPrompt.trim() }],
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        setPlayError(`HTTP ${res.status}: ${text.slice(0, 400)}`);
        return;
      }
      const data = await res.json();
      const msg = data.choices?.[0]?.message;
      setPlayResponse(
        (msg?.reasoning_content ? `── thinking ──\n${msg.reasoning_content}\n\n── reply ──\n` : "") +
          (msg?.content ?? JSON.stringify(data, null, 2))
      );
    } catch (e) {
      setPlayError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlayLoading(false);
    }
  };

  // ---------- render ----------

  const online = status?.health.healthy ?? false;

  return (
    <div className="flex min-h-screen flex-col bg-[#0b0b0d] text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-zinc-800/80 bg-[#0b0b0d]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 md:px-6">
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${online ? "animate-pulse bg-emerald-400" : "bg-red-500"}`}
              aria-hidden
            />
            <h1 className="text-base font-semibold tracking-tight md:text-lg">GLM Bridge — 管理面板</h1>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={online ? "border-emerald-800 text-emerald-400" : "border-red-800 text-red-400"}
            >
              {online ? "Bridge 在线 · :3001" : "Bridge 离线"}
            </Badge>
            <Badge variant="outline" className="border-zinc-700 text-zinc-400">
              {status?.token.mode === "token" ? "ZAI_TOKEN 已设置" : "访客会话"}
            </Badge>
            <Badge variant="outline" className="border-zinc-700 text-zinc-400">
              {status?.process.running ? `pid ${status.process.pid}` : "后台进程已停止"}
            </Badge>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:px-6">
        <Tabs defaultValue="overview">
          <TabsList className="mb-4 grid h-auto w-full grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1 sm:grid-cols-5">
            {[
              { value: "overview", label: "概览", icon: Activity },
              { value: "models", label: "模型", icon: ListTree },
              { value: "token", label: "ZAI 令牌", icon: KeyRound },
              { value: "logs", label: "日志", icon: ScrollText },
              { value: "playground", label: "测试台", icon: FlaskConical },
            ].map(({ value, label, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="data-[state=active]:bg-zinc-800 data-[state=active]:text-emerald-300 text-zinc-400"
              >
                <Icon className="mr-1.5 h-3.5 w-3.5" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab
              status={status}
              onAction={handleAction}
              actionPending={actionPending}
              onWatchdogAction={handleWatchdog}
              watchdogPending={watchdogPending}
            />
          </TabsContent>

          <TabsContent value="models">
            <ModelsTab models={models} loading={modelsLoading} error={modelsError} onRefresh={refreshModels} />
          </TabsContent>

          <TabsContent value="token">
            <TokenTab
              tokenState={tokenState}
              tokenInput={tokenInput}
              setTokenInput={setTokenInput}
              agentMode={agentMode}
              setAgentMode={setAgentMode}
              onSave={handleSaveToken}
              saving={savingToken}
              authState={status?.auth ?? null}
              authKeyInput={authKeyInput}
              setAuthKeyInput={setAuthKeyInput}
              onSaveAuthKey={handleSaveAuthKey}
              savingAuthKey={savingAuthKey}
            />
          </TabsContent>

          <TabsContent value="logs">
            <LogsTab lines={logLines} autoRefresh={logsAuto} setAutoRefresh={setLogsAuto} onRefresh={refreshLogs} />
          </TabsContent>

          <TabsContent value="playground">
            <PlaygroundTab
              models={models}
              model={playModel}
              setModel={setPlayModel}
              prompt={playPrompt}
              setPrompt={setPlayPrompt}
              response={playResponse}
              loading={playLoading}
              error={playError}
              onSend={handlePlaySend}
            />
          </TabsContent>
        </Tabs>
      </main>

      {/* Sticky footer */}
      <footer className="mt-auto border-t border-zinc-800/80 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 text-xs text-zinc-600 md:px-6">
          <span>GLM-Free-API · Go 后端运行于 localhost:3001 · 通过 /v1 代理</span>
          <span className="font-mono">github: izaart95-jpg/GLM-Free-API</span>
        </div>
      </footer>
    </div>
  );
}
