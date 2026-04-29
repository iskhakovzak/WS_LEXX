import { useState, useEffect } from "react";
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
import { User, Users, ChevronRight, Lock, AlertCircle, Shield, Zap } from "lucide-react";

function AnimatedBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 bg-grid-pattern opacity-40" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/5 rounded-full blur-[120px]" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[400px] bg-primary/3 rounded-full blur-[100px]" />
      <div className="absolute top-1/3 left-0 w-[300px] h-[300px] bg-chart-2/3 rounded-full blur-[80px]" />
      <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
    </div>
  );
}

function StatusIndicator() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const i = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(i);
  }, []);
  const hrs = time.getHours().toString().padStart(2, "0");
  const mins = time.getMinutes().toString().padStart(2, "0");
  const secs = time.getSeconds().toString().padStart(2, "0");
  return (
    <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground/60">
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
        <span>SYSTEM ONLINE</span>
      </div>
      <span className="text-border">|</span>
      <span>{hrs}:{mins}:{secs} UTC</span>
    </div>
  );
}

export default function LoginPage() {
  const { loginAsTrader, loginAsGuest, dbUsers } = useAuth();
  const [selectedTrader, setSelectedTrader] = useState<string>("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

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
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4 relative">
      <AnimatedBackground />

      <div className={`w-full max-w-[420px] space-y-6 relative z-10 transition-all duration-700 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center gap-3 relative">
            <div className="relative">
              <div className="w-3 h-3 bg-primary rounded-full" />
              <div className="absolute inset-0 w-3 h-3 bg-primary rounded-full animate-ping opacity-30" />
            </div>
            <h1 className="text-5xl font-black text-gradient font-mono tracking-tighter">
              WS_LEXX
            </h1>
          </div>
          <div className="flex items-center justify-center gap-3">
            <div className="h-px w-12 bg-gradient-to-r from-transparent to-primary/30" />
            <p className="text-muted-foreground text-[11px] font-mono uppercase tracking-[0.3em]">
              Prop Trading Desk
            </p>
            <div className="h-px w-12 bg-gradient-to-l from-transparent to-primary/30" />
          </div>
        </div>

        <div className={`glass-card glow-primary-sm rounded-lg overflow-hidden transition-all ${shake ? "animate-[shake_0.4s_ease-in-out]" : ""}`}>
          <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-5 py-3 border-b border-primary/10">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-primary/15 border border-primary/20 flex items-center justify-center">
                <Shield className="h-3.5 w-3.5 text-primary" />
              </div>
              <div>
                <div className="text-xs font-semibold font-mono uppercase tracking-wider text-foreground">
                  Авторизация
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">Войти как трейдер</div>
              </div>
            </div>
          </div>
          <div className="p-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Users className="h-3 w-3" />
                Трейдер
              </label>
              <Select value={selectedTrader} onValueChange={(v) => { setSelectedTrader(v); setError(false); }}>
                <SelectTrigger className="w-full font-mono bg-background/50 border-border/50 h-11 text-sm hover:border-primary/30 transition-colors">
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
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Lock className="h-3 w-3" />
                Пароль
              </label>
              <div className="relative">
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={10}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value.replace(/\D/g, "").slice(0, 10)); setError(false); }}
                  onKeyDown={handleKeyDown}
                  placeholder="Введите пароль"
                  className={`font-mono bg-background/50 border-border/50 h-11 text-sm tracking-[0.25em] hover:border-primary/30 transition-colors ${error ? "border-red-500/50 bg-red-500/5" : ""}`}
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-400 font-mono bg-red-500/5 border border-red-500/10 rounded-md px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                Неверный пароль — попробуйте ещё раз
              </div>
            )}

            <Button
              onClick={handleTraderLogin}
              disabled={!selectedTrader || password.length < 1}
              className="w-full font-mono uppercase tracking-wider text-xs gap-2 h-11 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-lg shadow-primary/20 transition-all duration-300"
              size="lg"
            >
              <Zap className="h-3.5 w-3.5" />
              Войти
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="glass-card rounded-lg overflow-hidden">
          <div className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-muted/50 border border-border/50 flex items-center justify-center">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div>
                <div className="text-xs font-semibold font-mono uppercase tracking-wider text-foreground">
                  Гостевой доступ
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">Только просмотр данных</div>
              </div>
            </div>
            <Button
              onClick={loginAsGuest}
              variant="outline"
              className="w-full font-mono uppercase tracking-wider text-xs h-10 border-border/50 hover:border-primary/30 hover:bg-primary/5 transition-all duration-300"
              size="lg"
            >
              Войти как гость
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-center">
          <StatusIndicator />
        </div>
      </div>
    </div>
  );
}
