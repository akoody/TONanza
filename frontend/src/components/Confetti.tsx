import { useEffect, useRef } from "react";

interface ConfettiProps {
    active: boolean;
    duration?: number;
}

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    rotation: number;
    rotationSpeed: number;
    color: string;
    size: number;
    gravity: number;
    opacity: number;
    shape: "rect" | "circle";
}

const COLORS = [
    "#FFD700", "#FF6B6B", "#06b6d4", "#F700FF",
    "#22c55e", "#fb7185", "#FFAA00", "#6366f1",
    "#14b8a6", "#fbbf24", "#f43f5e", "#8b5cf6",
];

export function Confetti({ active, duration = 3000 }: ConfettiProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const particlesRef = useRef<Particle[]>([]);
    const animFrameRef = useRef<number>(0);
    const startTimeRef = useRef<number>(0);

    useEffect(() => {
        if (!active || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = Math.min(window.innerWidth, 448);
        canvas.height = window.innerHeight;

        // Spawn particles
        const particles: Particle[] = [];
        const count = 150;
        for (let i = 0; i < count; i++) {
            particles.push({
                x: canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.4,
                y: canvas.height * 0.3 + (Math.random() - 0.5) * 100,
                vx: (Math.random() - 0.5) * 12,
                vy: -(Math.random() * 8 + 4),
                rotation: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 15,
                color: COLORS[Math.floor(Math.random() * COLORS.length)],
                size: Math.random() * 8 + 4,
                gravity: 0.15 + Math.random() * 0.1,
                opacity: 1,
                shape: Math.random() > 0.5 ? "rect" : "circle",
            });
        }
        particlesRef.current = particles;
        startTimeRef.current = performance.now();

        const animate = (time: number) => {
            const elapsed = time - startTimeRef.current;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const fadeOut = elapsed > duration * 0.6
                ? 1 - (elapsed - duration * 0.6) / (duration * 0.4)
                : 1;

            for (const p of particles) {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += p.gravity;
                p.vx *= 0.99;
                p.rotation += p.rotationSpeed;
                p.opacity = Math.max(0, fadeOut);

                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rotation * Math.PI) / 180);
                ctx.globalAlpha = p.opacity;
                ctx.fillStyle = p.color;

                if (p.shape === "rect") {
                    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
                } else {
                    ctx.beginPath();
                    ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }

            if (elapsed < duration) {
                animFrameRef.current = requestAnimationFrame(animate);
            }
        };

        animFrameRef.current = requestAnimationFrame(animate);

        return () => {
            cancelAnimationFrame(animFrameRef.current);
        };
    }, [active, duration]);

    if (!active) return null;

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-y-0 inset-x-0 mx-auto w-full h-full max-w-md z-[230] pointer-events-none"
        />
    );
}
