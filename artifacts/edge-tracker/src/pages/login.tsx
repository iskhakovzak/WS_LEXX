import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { User, Users, ChevronRight, Lock, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const { loginAsTrader, loginAsGuest, dbUsers } = useAuth();
  const [selectedTrader, setSelectedTrader] = useState<string>("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  const traderNames = dbUsers.filter((u) => u.active).map((u) => u.name);

  function handleTraderLogin() {
    if (!selectedTrader || !password) return;
    const ok = loginAsTrader(selectedTrader, password);
    if (!ok) {
      setError(true);
      setShake(true);
      setPassword("");
      setTimeout(() => setShake(false), 500);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleTraderLogin();
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2">
            <div className="w-2.5 h-2.5 bg-primary rounded-full animate-pulse" />
            <h1 className="text-4xl font-bold text-primary font-mono tracking-tight">
              WS_LEXX
            </h1>
          </div>
          <div className="w-12 h-[1px] bg-primary/30 mx-auto" />
          <p className="text-muted-foreground text-xs font-mono uppercase tracking-widest">
            Prop Trading Desk
          </p>
        </div>

        <div className={`bg-card border border-border border-l-[3px] border-l-primary transition-all ${shake ? "animate-[shake_0.4s_ease-in-out]" : ""}`}>
          <div className="px-5 pt-5 pb-3 space-y-3">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground mb-1">
              <Users className="h-4 w-4 text-primary" />
              Войти как Трейдер
            </div>
            <Select value={selectedTrader} onValueChange={(v) => { setSelectedTrader(v); setError(false); }}>
              <SelectTrigger className="w-full font-mono bg-muted/30 border-border">
                <SelectValue placeholder="Выберите трейдера..." />
              </SelectTrigger>
              <SelectContent>
                {traderNames.map((name) => (
                  <SelectItem key={name} value={name} className="font-mono">
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                type="password"
                inputMode="numeric"
                maxLength={10}
                value={password}
                onChange={(e) => { setPassword(e.target.value.replace(/\D/g, "").slice(0, 10)); setError(false); }}
                onKeyDown={handleKeyDown}
                placeholder="Пароль"
                className={`pl-9 font-mono bg-muted/30 border-border text-sm tracking-[0.3em] ${error ? "border-red-500/70 bg-red-500/5" : ""}`}
              />
            </div>

            {error && (
              <div className="flex items-center gap-1.5 text-xs text-red-400 font-mono">
                <AlertCircle className="h-3.5 w-3.5" />
                Неверный пароль
              </div>
            )}
          </div>
          <div className="px-5 pb-5">
            <Button
              onClick={handleTraderLogin}
              disabled={!selectedTrader || password.length < 1}
              className="w-full font-mono uppercase tracking-wider text-xs gap-2"
              size="lg"
            >
              Войти <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="bg-card border border-border border-l-[3px] border-l-muted">
          <div className="px-5 py-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
              <User className="h-4 w-4" />
              Гостевой доступ
            </div>
            <Button
              onClick={loginAsGuest}
              variant="outline"
              className="w-full font-mono uppercase tracking-wider text-xs"
              size="lg"
            >
              Войти как гость
            </Button>
          </div>
        </div>

        <p className="text-center text-[10px] text-muted-foreground/50 font-mono uppercase tracking-widest">
          Гость — только просмотр
        </p>
      </div>
    </div>
  );
}
