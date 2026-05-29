import { Bell, BriefcaseBusiness, ChevronDown, ClipboardCopy, ImagePlus, Info, Languages, LockKeyhole, Plus, RotateCcw, Search, Send, Settings, Trash2, Users } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { closeDeal, createDeal, getDeal, getMe, listDeals, sendMessage, sendNotification, sendPhotos, sendRequisites } from "./lib/api";
import { haptic, initTelegram } from "./lib/telegram";
import type { ChatMessage, Deal, DealListItem, DealRole, User } from "./types";

type Screen = "home" | "find" | "create" | "code" | "deal";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || undefined;

const statusIcon = (status: DealListItem["status"]) => {
  if (status === "CLOSED") return <BriefcaseBusiness className="status-red" size={23} />;
  if (status === "WAITING_PAYMENT") return <Bell className="status-yellow" size={23} />;
  return <Bell className="status-green" size={23} />;
};

const displayName = (user: User | null) => {
  if (!user) return "Система";
  return user.firstName || user.username || `ID ${user.telegramId.slice(-4)}`;
};

function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [me, setMe] = useState<User | null>(null);
  const [deals, setDeals] = useState<DealListItem[]>([]);
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [createdCode, setCreatedCode] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    initTelegram();
    void bootstrap();
    const code = new URLSearchParams(window.location.search).get("deal");
    if (code) void openDeal(code);
  }, []);

  useEffect(() => {
    if (screen === "find") void refreshDeals(query);
  }, [screen]);

  const bootstrap = async () => {
    try {
      setMe(await getMe());
    } catch (caught) {
      console.warn("Backend is not available for local preview", caught);
    }
  };

  const refreshDeals = async (value = query) => {
    try {
      setDeals(await listDeals(value));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить сделки");
    }
  };

  const openDeal = async (code: string) => {
    setLoading(true);
    setError("");
    try {
      const deal = await getDeal(code);
      setActiveDeal(deal);
      setScreen("deal");
      haptic();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Сделка не найдена");
    } finally {
      setLoading(false);
    }
  };

  const go = (next: Screen) => {
    setError("");
    setScreen(next);
    haptic();
  };

  return (
    <main className="app-shell">
      {screen !== "home" && <TopNav />}
      {error && <div className="toast">{error}</div>}
      {loading && <div className="loading-line">Загрузка...</div>}

      {screen === "home" && <HomeScreen onCreate={() => go("create")} onFind={() => go("find")} />}
      {screen === "find" && (
        <FindScreen
          deals={deals}
          query={query}
          onQuery={setQuery}
          onSearch={() => refreshDeals(query)}
          onOpen={openDeal}
        />
      )}
      {screen === "create" && (
        <CreateScreen
          onCreated={(deal) => {
            setCreatedCode(deal.code);
            setActiveDeal(deal);
            go("code");
          }}
          onError={setError}
        />
      )}
      {screen === "code" && <CodeScreen code={createdCode} onBack={() => go("home")} />}
      {screen === "deal" && activeDeal && (
        <DealScreen
          deal={activeDeal}
          me={me}
          onDeal={setActiveDeal}
          onBack={() => go("find")}
          onError={setError}
        />
      )}
    </main>
  );
}

function TopNav() {
  return (
    <nav className="top-nav" aria-label="Разделы">
      <button className="nav-active" aria-label="Информация"><Info size={25} /></button>
      <button aria-label="Язык"><Languages size={28} /></button>
      <button aria-label="Настройки"><Settings size={28} /></button>
    </nav>
  );
}

function HomeScreen({ onCreate, onFind }: { onCreate: () => void; onFind: () => void }) {
  return (
    <section className="home-screen pixel-home" aria-label="Главный экран">
      <button className="pixel-hit create-hit" onClick={onCreate} aria-label="Создать сделку" />
      <button className="pixel-hit find-hit" onClick={onFind} aria-label="Найти сделку" />
    </section>
  );
}

function FindScreen(props: {
  deals: DealListItem[];
  query: string;
  onQuery: (value: string) => void;
  onSearch: () => void;
  onOpen: (code: string) => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSearch();
  };

  return (
    <section className="content-screen">
      <h1><Search size={18} />Найти сделку</h1>
      <form onSubmit={submit} className="stack">
        <input value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder="Введите данные" />
        <button className="primary-btn enter-btn" type="submit">Войти</button>
      </form>
      <div className="list-panel">
        <div className="panel-title">Существующие сделки <ChevronDown size={22} /></div>
        <div className="deal-list">
          {props.deals.length === 0 && <div className="empty">Сделок пока нет</div>}
          {props.deals.map((deal) => (
            <button key={deal.code} className="deal-row" onClick={() => props.onOpen(deal.code)}>
              <span>{deal.title}</span>
              {statusIcon(deal.status)}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function CreateScreen({ onCreated, onError }: { onCreated: (deal: Deal) => void; onError: (message: string) => void }) {
  const [title, setTitle] = useState("");
  const [terms, setTerms] = useState("");
  const [role, setRole] = useState<DealRole>("BUYER");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const deal = await createDeal({ title, terms, ownerRole: role, amount: Number(amount) });
      onCreated(deal);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Не удалось создать сделку");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="content-screen">
      <h1><Plus size={18} />Создать сделку</h1>
      <form className="create-form" onSubmit={submit}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Введите данные" maxLength={120} />
        <label className="field-title">Условия сделки</label>
        <textarea value={terms} onChange={(event) => setTerms(event.target.value)} placeholder="Введите данные" maxLength={2000} />
        <label className="field-title">Роль</label>
        <div className="radio-group">
          <label><input type="radio" checked={role === "BUYER"} onChange={() => setRole("BUYER")} />Покупатель</label>
          <label><input type="radio" checked={role === "SELLER"} onChange={() => setRole("SELLER")} />Продавец</label>
        </div>
        <label className="field-title">Сумма сделки</label>
        <div className="select-shell">
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="Выберите сумму" />
          <ChevronDown size={23} />
        </div>
        <button className="primary-btn wide" disabled={saving}>{saving ? "Создание..." : "Создать сделку"}</button>
      </form>
    </section>
  );
}

function CodeScreen({ code, onBack }: { code: string; onBack: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    haptic();
  };
  return (
    <section className="content-screen code-screen">
      <h1><LockKeyhole size={18} />Код сделки</h1>
      <div className="code-box">{code}</div>
      <button className="primary-btn copy-btn" onClick={copy}><ClipboardCopy size={19} />{copied ? "Код скопирован" : "Копировать код"}</button>
      <button className="back-btn" onClick={onBack}><RotateCcw size={21} />Вернуться назад</button>
    </section>
  );
}

function DealScreen({ deal, me, onDeal, onBack, onError }: {
  deal: Deal;
  me: User | null;
  onDeal: (deal: Deal) => void;
  onBack: () => void;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const isAdminView = Boolean(me?.isAdmin || deal.viewer.isAdmin);

  useEffect(() => {
    const socket: Socket = io(SOCKET_URL, { query: { dealCode: deal.code } });
    socket.on("deal:update", (next: Deal) => onDeal(next));
    return () => {
      socket.disconnect();
    };
  }, [deal.code, onDeal]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [deal.messages.length]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    try {
      onDeal(await sendMessage(deal.code, text));
      setText("");
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Не удалось отправить сообщение");
    }
  };

  const upload = async (files: FileList | null) => {
    const selected = Array.from(files ?? []).slice(0, 10);
    if (selected.length === 0) return;
    try {
      onDeal(await sendPhotos(deal.code, selected));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Не удалось отправить фото");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <section className={isAdminView ? "content-screen admin-deal-screen" : "deal-screen"}>
      {isAdminView && <h1><Users size={18} />Чат с пользователем</h1>}
      <div className="chat-card">
        <header className="chat-header">
          <div className="avatar">{isAdminView ? "C" : deal.title.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{isAdminView ? "Пользователь" : deal.title}</strong>
            {isAdminView && <span>{deal.title}</span>}
          </div>
          <button aria-label="Уведомления"><Bell size={22} /></button>
          {isAdminView && <button aria-label="Закрыть" onClick={() => void closeDeal(deal.code).then(onDeal).catch((e) => onError(e.message))}><Trash2 size={21} /></button>}
        </header>

        <div className="messages">
          {deal.messages.filter((message) => message.kind !== "SYSTEM").map((message) => (
            <MessageBubble key={message.id} message={message} currentUserId={deal.viewer.id} />
          ))}
          <div ref={bottomRef} />
        </div>

        {isAdminView && (
          <div className="admin-actions">
            <button className="manage-btn" onClick={() => setAdminOpen((value) => !value)}>
              Управлять <ChevronDown size={20} />
            </button>
            {adminOpen && <AdminPanel deal={deal} onDeal={onDeal} onError={onError} onClose={() => setAdminOpen(false)} />}
          </div>
        )}

        <form className="message-form" onSubmit={submit}>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(event) => void upload(event.target.files)} />
          <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()}><ImagePlus size={22} /></button>
          <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Написать..." disabled={deal.status === "CLOSED"} />
          <button type="submit" className="send-btn" disabled={deal.status === "CLOSED"}><Send size={25} /></button>
        </form>
      </div>
      {!isAdminView && <button className="back-inline" onClick={onBack}>Назад к списку</button>}
    </section>
  );
}

function MessageBubble({ message, currentUserId }: { message: ChatMessage; currentUserId: string }) {
  const mine = message.user?.id === currentUserId;
  const admin = Boolean(message.user?.isAdmin) || message.kind === "REQUISITES" || message.kind === "NOTIFICATION";
  const name = admin ? "Админ" : displayName(message.user);

  return (
    <div className={`message ${mine ? "mine" : "theirs"}`}>
      <span className="message-author">• {name}</span>
      <div className={`bubble ${message.kind.toLowerCase()}`}>
        {message.photoUrl ? <img src={message.photoUrl} alt="Фото сделки" /> : message.text}
      </div>
    </div>
  );
}

function AdminPanel({ deal, onDeal, onError, onClose }: {
  deal: Deal;
  onDeal: (deal: Deal) => void;
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const actions = useMemo(() => [
    { label: "Отправить реквизиты", run: () => sendRequisites(deal.code, text) },
    { label: "Отправить уведомление", run: () => sendNotification(deal.code, text) },
    { label: "Закрыть сделку", run: () => closeDeal(deal.code), danger: true }
  ], [deal.code, text]);

  const run = async (action: (typeof actions)[number]) => {
    try {
      if (!action.danger && !text.trim()) {
        onError("Введите текст действия");
        return;
      }
      onDeal(await action.run());
      setText("");
      onClose();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Действие не выполнено");
    }
  };

  return (
    <div className="admin-panel">
      <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Текст для чата или уведомления" />
      {actions.map((action) => (
        <button key={action.label} className={action.danger ? "danger-action" : ""} onClick={() => void run(action)}>
          {action.label}
        </button>
      ))}
    </div>
  );
}

export default App;
