"use client";

// src/components/admin/token-tab.tsx

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { KeyRound, Loader2, Save, UserRound, ShieldCheck, Copy, Check, LockOpen } from "lucide-react";
import { useState } from "react";
import type { TokenState } from "./types";

export interface AuthKeyStateView {
  mode: "open" | "key";
  key: string | null;
  masked: string | null;
}

export function TokenTab({
  tokenState,
  tokenInput,
  setTokenInput,
  agentMode,
  setAgentMode,
  onSave,
  saving,
  authState,
  authKeyInput,
  setAuthKeyInput,
  onSaveAuthKey,
  savingAuthKey,
}: {
  tokenState: TokenState | null;
  tokenInput: string;
  setTokenInput: (v: string) => void;
  agentMode: boolean;
  setAgentMode: (v: boolean) => void;
  onSave: () => void;
  saving: boolean;
  authState: AuthKeyStateView | null;
  authKeyInput: string;
  setAuthKeyInput: (v: string) => void;
  onSaveAuthKey: () => void;
  savingAuthKey: boolean;
}) {
  const isToken = tokenState?.mode === "token";
  const authKeySet = authState?.mode === "key";
  const [copied, setCopied] = useState(false);

  const copyKey = async () => {
    if (!authState?.key) return;
    try {
      await navigator.clipboard.writeText(authState.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="border-zinc-800 bg-zinc-900/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-zinc-200">
            <KeyRound className="h-4 w-4 text-emerald-400" /> ZAI_TOKEN
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            {isToken ? (
              <Badge className="border-emerald-800 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-950/60">
                登录会话
              </Badge>
            ) : (
              <Badge className="border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-800">
                访客会话
              </Badge>
            )}
            <span className="truncate font-mono text-xs text-zinc-500">
              {isToken ? tokenState?.masked : "未设置令牌"}
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="zai-token" className="text-zinc-400">
              粘贴新令牌（来自 chat.z.ai 的 JWT）
            </Label>
            <Input
              id="zai-token"
              type="password"
              placeholder="eyJhbGciOi…  （留空以切换回访客模式）"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="border-zinc-800 bg-zinc-950 font-mono text-xs text-zinc-200 placeholder:text-zinc-600"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
            <div>
              <p className="text-sm text-zinc-300">Agent 模式</p>
              <p className="text-xs text-zinc-500">通过现代 XML 兼容层支持工具调用</p>
            </div>
            <Switch checked={agentMode} onCheckedChange={setAgentMode} />
          </div>

          <Button
            onClick={onSave}
            disabled={saving}
            className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 保存并重启后端…
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" /> 保存并应用（重启后端）
              </>
            )}
          </Button>
          <p className="text-xs leading-relaxed text-zinc-500">
            保存后将使用 <span className="font-mono">ZAI_TOKEN</span> 到其环境变量中，然后立即重新获取模型目录。留空后将切换回
            访客模式（仅支持 glm-4.7 / glm-5.3-flash，不支持视觉）。
          </p>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-zinc-200">
            <UserRound className="h-4 w-4 text-emerald-400" /> 如何获取令牌
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-zinc-400">
          <ol className="list-decimal space-y-2 pl-5">
            <li>在 <span className="font-mono text-zinc-300">https://chat.z.ai</span> 中登录。</li>
            <li>打开开发者工具（<span className="font-mono text-zinc-300">F12</span>) → 控制台。</li>
            <li>
              运行 <span className="font-mono text-emerald-300">localStorage.getItem(&apos;token&apos;)</span> 并复制
              输出的 JWT。
            </li>
            <li>粘贴到左侧并点击 <span className="text-zinc-300">保存并应用</span>.</li>
          </ol>
          <div className="rounded-md border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200/90">
            <p className="font-semibold">令牌可解锁的功能</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>完整 GLM-5.x 模型目录 （5.2 / 5.3 / Turbo 版本）</li>
              <li>视觉图片上传 （每次最多 10 张图片 / 50 MB）</li>
              <li>使用你的账户配额，而不是匿名访客限制</li>
            </ul>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-500">
            令牌仅存储在本机
            (<span className="font-mono">GLM-Free-API/admin-config.json</span>) 并作为环境变量注入
            后台进程启动时。除 chat.z.ai 外绝不会发送到其他地方。
          </div>
        </CardContent>
      </Card>

      {/* Client auth key — full width card below the two above */}
      <Card className="border-zinc-800 bg-zinc-900/40 lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base text-zinc-200">
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> 客户端认证密钥（OpenAI / Anthropic 客户端）
            </span>
            <div className="flex items-center gap-2">
              {authKeySet ? (
                <Badge className="border-emerald-800 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-950/60">
                  需要密钥
                </Badge>
              ) : (
                <Badge className="border-amber-800 bg-amber-950/40 text-amber-300 hover:bg-amber-950/40">
                  开放访问——允许任意密钥或不提供密钥
                </Badge>
              )}
              {authKeySet ? (
                <span className="truncate font-mono text-xs text-zinc-500">{authState?.masked}</span>
              ) : null}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="client-auth-key" className="text-zinc-400">
                API 密钥客户端必须在 <span className="font-mono">/v1</span>
              </Label>
              <Input
                id="client-auth-key"
                type="text"
                placeholder="例如 sk-my-secret-key-123  （留空 = 开放访问）"
                value={authKeyInput}
                onChange={(e) => setAuthKeyInput(e.target.value)}
                className="border-zinc-800 bg-zinc-950 font-mono text-xs text-zinc-200 placeholder:text-zinc-600"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={onSaveAuthKey}
                disabled={savingAuthKey}
                className="flex-1 bg-emerald-600 text-white hover:bg-emerald-500"
              >
                {savingAuthKey ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 保存中…
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" /> 保存密钥（立即生效）
                  </>
                )}
              </Button>
              {authKeySet ? (
                <Button
                  variant="outline"
                  disabled={savingAuthKey}
                  onClick={() => {
                    setAuthKeyInput("");
                    onSaveAuthKey();
                  }}
                  className="border-zinc-700 bg-transparent hover:bg-zinc-800 hover:text-amber-300"
                >
                  <LockOpen className="mr-1 h-3.5 w-3.5" /> 关闭认证
                </Button>
              ) : null}
            </div>
            <p className="text-xs leading-relaxed text-zinc-500">
              留空并保存 = 开放访问（默认）：允许任意密钥或不提供密钥。 当设置密钥后，客户端
              必须通过{" "}
              <span className="font-mono text-zinc-300">Authorization: Bearer &lt;key&gt;</span> 或{" "}
              <span className="font-mono text-zinc-300">x-api-key: &lt;key&gt;</span>. 更改将在
              下一次请求生效——无需重启。
            </p>
          </div>
          <div className="space-y-3">
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-xs leading-relaxed text-zinc-500">
              {authKeySet ? (
                <>
                  <p className="mb-1.5 text-zinc-400">客户端快速配置：</p>
                  <p className="font-mono text-zinc-300">base_url = http://&lt;panel-url&gt;/v1</p>
                  <p className="font-mono text-zinc-300">api_key = {authState?.key}</p>
                </>
              ) : (
                <>
                  <p>
                    开放访问虽然方便，但意味着 <span className="text-amber-300/90">任何人</span> 能够
                    访问此面板地址的任何人都可以使用 Bridge 并消耗 CAPTCHA 令牌。公开面板之前请设置认证密钥。

                  </p>
                </>
              )}
            </div>
            {authKeySet ? (
              <button
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200"
                onClick={copyKey}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "已复制！" : "复制完整密钥"}
              </button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
