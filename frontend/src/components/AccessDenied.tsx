import { Send } from "lucide-react";

export function AccessDenied() {
    return (
        <div className="flex flex-col items-center justify-center min-h-[100dvh] w-full bg-slate-950 text-white p-6 text-center">
            <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mb-6 animate-pulse">
                <Send className="w-10 h-10 text-cyan-400" />
            </div>

            <h1 className="text-2xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-emerald-400">
                TONanza
            </h1>

            <h2 className="text-xl font-semibold mb-4 text-slate-200">
                Access Denied
            </h2>

            <p className="text-slate-400 max-w-xs mb-8 leading-relaxed">
                This application is designed to be played exclusively inside Telegram.
                <br /><br />
                Please open the bot to start playing.
            </p>

            <a
                href="https://t.me/tonanza_bot/app"
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 rounded-xl font-bold shadow-lg shadow-cyan-900/20 hover:scale-105 transition-transform"
            >
                Open in Telegram
            </a>
        </div>
    );
}
