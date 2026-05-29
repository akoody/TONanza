import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
    id: string;
    message: string;
    type: ToastType;
    duration?: number;
}

interface ToastContextType {
    toast: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error("useToast must be used within a ToastProvider");
    }
    return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const toast = useCallback((message: string, type: ToastType = "info", duration = 3000) => {
        const id = Math.random().toString(36).substring(2, 9);
        setToasts((prev) => [...prev, { id, message, type, duration }]);

        if (duration > 0) {
            setTimeout(() => {
                removeToast(id);
            }, duration);
        }
    }, [removeToast]);

    return (
        <ToastContext.Provider value={{ toast }}>
            {children}
            <div className="fixed left-1/2 -translate-x-1/2 top-[calc(env(safe-area-inset-top,0px)+86px)] z-[200] flex w-[min(92vw,26rem)] flex-col gap-2 pointer-events-none sm:left-auto sm:right-4 sm:w-auto sm:translate-x-0 sm:top-20">
                <AnimatePresence>
                    {toasts.map((t) => (
                        <ToastItem key={t.id} toast={t} onRemove={() => removeToast(t.id)} />
                    ))}
                </AnimatePresence>
            </div>
        </ToastContext.Provider>
    );
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
    const bgColors = {
        success: "bg-emerald-900/90 border-emerald-500/50 text-emerald-100",
        error: "bg-rose-900/90 border-rose-500/50 text-rose-100",
        info: "bg-cyan-900/90 border-cyan-500/50 text-cyan-100",
        warning: "bg-amber-900/90 border-amber-500/50 text-amber-100",
    };

    return (
        <motion.div
            initial={{ opacity: 0, x: 50, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.9 }}
            layout
            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md shadow-lg w-full sm:min-w-[300px] sm:max-w-md ${bgColors[toast.type]}`}
        >
            <div className="flex-1 text-sm font-medium">{toast.message}</div>
            <button onClick={onRemove} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                <X size={14} />
            </button>
        </motion.div>
    );
}
