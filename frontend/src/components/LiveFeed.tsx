import { AnimatePresence, motion } from "framer-motion";
import { Radio } from "lucide-react";
import type { LiveEvent } from "../types";

type LiveFeedProps = {
  events: LiveEvent[];
};

export const LiveFeed = ({ events }: LiveFeedProps) => {
  return (
    <section className="rounded-2xl border border-teal-500/10 bg-teal-900/20 p-3 backdrop-blur-md">
      <header className="mb-2 flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.2em] text-teal-200/70">Live Feed</p>
        <span className="inline-flex items-center gap-1 text-[11px] text-pink-300">
          <Radio className="h-3.5 w-3.5 animate-pulse" />
          Hot
        </span>
      </header>

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {events.map((event) => (
            <motion.div
              key={event.id}
              layout
              initial={{ opacity: 0, x: 24, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -18, scale: 0.98 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="rounded-xl border border-teal-500/10 bg-slate-900/65 px-3 py-2"
            >
              <p className="text-sm text-slate-100">{event.text}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
};
