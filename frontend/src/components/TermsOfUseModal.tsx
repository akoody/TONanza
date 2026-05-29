import { AnimatePresence, motion } from "framer-motion";
import { FileText, X } from "lucide-react";

interface TermsOfUseModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type TermsSection = {
    title: string;
    paragraphs?: string[];
    bullets?: string[];
};

const LAST_UPDATED_LABEL = "03 марта 2026";
const MOBILE_MODAL_TOP_OFFSET_PX = 68;
const MOBILE_MODAL_BOTTOM_GAP_PX = 50;
const MOBILE_MODAL_MAX_HEIGHT = `min(84vh, calc(100dvh - env(safe-area-inset-top, 0px) - max(env(safe-area-inset-bottom, 0px), 1rem) - ${MOBILE_MODAL_TOP_OFFSET_PX + MOBILE_MODAL_BOTTOM_GAP_PX}px))`;

const TERMS_SECTIONS: TermsSection[] = [
    {
        title: "1. О документе",
        paragraphs: [
            "Настоящие Условия регулируют доступ к TONanza (Telegram Mini App, связанные боты, API и каналы связи) и порядок использования его функций.",
            "Продолжая использование Сервиса, пользователь подтверждает, что ознакомился с условиями и принимает их в полном объеме.",
            "Если пользователь не согласен с условиями, он обязан прекратить использование TONanza."
        ]
    },
    {
        title: "2. Термины",
        bullets: [
            "«Сервис» — TONanza, включая интерфейс Mini App, API и официальные каналы коммуникации.",
            "«Пользователь» — лицо, использующее Сервис через Telegram и/или подключенный TON-кошелек.",
            "«Кошелек» — стороннее приложение для хранения TON и подписания транзакций.",
            "«Раунд» — игровой цикл, в рамках которого принимаются ставки и определяется результат.",
            "«Баланс» — учетный показатель в Сервисе, рассчитываемый по подтвержденным операциям."
        ]
    },
    {
        title: "3. Доступ и безопасность",
        paragraphs: [
            "Пользователь самостоятельно проверяет, что использует официальный интерфейс TONanza, и несет риски перехода по поддельным ссылкам.",
            "Сервис никогда не запрашивает seed-фразу, приватные ключи или иные данные полного доступа к кошельку.",
            "Пользователь несет ответственность за безопасность своего Telegram-аккаунта, устройства и кошелька."
        ],
        bullets: [
            "При признаках мошенничества, обхода ограничений или злоупотреблений доступ к отдельным функциям может быть временно ограничен до завершения проверки.",
            "Сервис вправе отказать в доступе пользователям, нарушающим эти Условия или применимое законодательство."
        ]
    },
    {
        title: "4. Допустимое использование",
        paragraphs: [
            "TONanza предоставляет ограниченную, отзывную и непередаваемую лицензию на личное некоммерческое использование интерфейса."
        ],
        bullets: [
            "Запрещено использовать ботов, скрипты, парсинг, reverse engineering и иные методы автоматизированного вмешательства.",
            "Запрещены действия, направленные на перегрузку, взлом, обход защитных механизмов или нарушение стабильности Сервиса.",
            "Запрещено использовать Сервис для незаконной деятельности, включая мошенничество, отмывание средств и нарушение прав третьих лиц.",
            "Запрещено публиковать в чате оскорбительный, противоправный, токсичный или спам-контент."
        ]
    },
    {
        title: "5. Ставки, комиссии и выплаты",
        paragraphs: [
            "Ставка считается принятой только после успешной обработки операции Сервисом и отображения в интерфейсе.",
            "Результаты раунда рассчитываются по механике Provably Fair, публикуемой в приложении.",
            "Выигрыши и выводы зависят от доступности блокчейн-сети, провайдеров и внешних сервисов; возможны задержки, не зависящие от TONanza."
        ],
        bullets: [
            "Комиссии, лимиты и минимальные суммы могут изменяться и публикуются в актуальном интерфейсе Сервиса.",
            "Пользователь самостоятельно оценивает финансовые и правовые последствия участия в раундах."
        ]
    },
    {
        title: "6. Кошельки и сторонние сервисы",
        paragraphs: [
            "TONanza не контролирует сторонние кошельки, инфраструктуру блокчейн-провайдеров и сервисы партнеров.",
            "Сервис не отвечает за сбои, потерю доступа, ошибки подписания транзакций или иные проблемы на стороне таких поставщиков.",
            "Факт интеграции кошелька или сервиса не является рекомендацией и не считается инвестиционной или финансовой консультацией."
        ]
    },
    {
        title: "7. Чат и модерация",
        paragraphs: [
            "Чат предоставляется для общения пользователей в рамках Сервиса.",
            "Сервис вправе удалять сообщения и ограничивать доступ к чату без предварительного уведомления при нарушении правил."
        ],
        bullets: [
            "Запрещены угрозы, травля, язык вражды, мошеннические схемы и распространение вредоносных ссылок.",
            "Решения модерации принимаются для защиты пользователей и стабильности работы Сервиса."
        ]
    },
    {
        title: "8. Интеллектуальная собственность",
        paragraphs: [
            "Код, дизайн, брендовые элементы, тексты и иные материалы TONanza принадлежат правообладателю Сервиса или используются на законных основаниях.",
            "Копирование, распространение, коммерческое использование и создание производных работ без письменного согласия правообладателя запрещены."
        ]
    },
    {
        title: "9. Отказ от гарантий и ответственность",
        paragraphs: [
            "Сервис предоставляется «как есть» и «по мере доступности» без гарантий бесперебойной работы, полной точности данных или соответствия ожиданиям пользователя.",
            "TONanza не несет ответственности за косвенные убытки, упущенную выгоду, потерю доступа к кошельку, ошибки пользователя или действия третьих лиц.",
            "Использование Сервиса осуществляется пользователем на собственный риск и с учетом ограничений его юрисдикции."
        ]
    },
    {
        title: "10. Персональные данные",
        paragraphs: [
            "Для работы TONanza могут обрабатываться технические и учетные данные, необходимые для авторизации, игровых операций и предотвращения злоупотреблений.",
            "Сервис не запрашивает и не хранит приватные ключи кошелька пользователя.",
            "Дополнительные сведения об обработке данных публикуются в политике конфиденциальности, если такая политика доступна в интерфейсе."
        ]
    },
    {
        title: "11. Обновление условий",
        paragraphs: [
            "TONanza вправе изменять эти Условия в любое время.",
            "Новая редакция вступает в силу с момента публикации в интерфейсе. Продолжение использования Сервиса означает принятие обновленной редакции."
        ]
    },
    {
        title: "12. Применимое право и контакты",
        paragraphs: [
            "К отношениям сторон применяется право юрисдикции оператора TONanza, если иное не предусмотрено императивными нормами.",
            "Споры, которые не удалось урегулировать переговорами, рассматриваются в компетентном суде по месту регистрации оператора Сервиса.",
            "Вопросы по Условиям использования направляйте через официальный канал поддержки TONanza, указанный в интерфейсе приложения."
        ]
    }
];

const OVERLAY_TRANSITION = { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const };
const PANEL_TRANSITION = { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const };

export function TermsOfUseModal({ isOpen, onClose }: TermsOfUseModalProps) {
    return (
        <AnimatePresence mode="wait" initial={false}>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={OVERLAY_TRANSITION}
                    className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-md px-4 pb-3 pt-4 flex items-start justify-center sm:items-center sm:p-4"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ opacity: 0, y: 14, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.985 }}
                        transition={PANEL_TRANSITION}
                        className="mt-[calc(env(safe-area-inset-top,0px)+62px)] sm:mt-0 flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-cyan-400/20 bg-teal-950/95 shadow-[0_20px_80px_rgba(6,182,212,0.2)]"
                        style={{ maxHeight: MOBILE_MODAL_MAX_HEIGHT }}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                            <div className="flex items-center gap-2 min-w-0">
                                <FileText size={18} className="text-cyan-300 shrink-0" />
                                <div className="min-w-0">
                                    <h3 className="text-sm font-black uppercase tracking-widest text-white truncate">Условия использования</h3>
                                    <p className="text-[10px] uppercase tracking-wider text-cyan-100/65">
                                        Обновлено: {LAST_UPDATED_LABEL}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-all duration-200 ease-out active:scale-95"
                                aria-label="Закрыть условия использования"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="min-h-0 overflow-y-auto px-4 py-3">
                            <div className="space-y-4">
                                <p className="rounded-xl border border-cyan-400/15 bg-cyan-500/5 px-3 py-2 text-xs leading-relaxed text-white/80">
                                    Ниже собраны основные правила использования TONanza, права пользователя и ключевые ограничения ответственности сервиса.
                                </p>

                                {TERMS_SECTIONS.map((section) => (
                                    <section
                                        key={section.title}
                                        className="rounded-xl border border-white/10 bg-white/5 p-3"
                                    >
                                        <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-cyan-100">
                                            {section.title}
                                        </h4>

                                        {section.paragraphs?.map((paragraph) => (
                                            <p key={paragraph} className="mb-2 text-xs leading-relaxed text-white/75 last:mb-0">
                                                {paragraph}
                                            </p>
                                        ))}

                                        {section.bullets && (
                                            <ul className="mt-2 space-y-1.5">
                                                {section.bullets.map((bullet) => (
                                                    <li key={bullet} className="flex items-start gap-2 text-xs leading-relaxed text-white/75">
                                                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300/80" />
                                                        <span>{bullet}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </section>
                                ))}
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
