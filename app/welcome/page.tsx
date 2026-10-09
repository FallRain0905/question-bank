import SynapTopDock from "@/components/new-theme/SynapTopDock";
import SynapWordmark from "@/components/new-theme/SynapWordmark";
import HoloButton from "@/components/new-theme/HoloButton";
import ConstellationBackdrop from "@/components/new-theme/ConstellationBackdrop";

/*
 * Public entry for signed-out visitors — middleware sends anonymous requests for `/`
 * here, signed-in users keep the workbench dashboard.
 *
 * Structure and motion are borrowed from the four ThreeUI components; the copy, the
 * palette and the destinations are SynapFlow's. The untouched reference mounts live at
 * /theme/reference, and components/threeui/README.md records where each piece came from.
 */

export default function WelcomePage() {
  return (
    <main className="min-h-screen bg-[#07080c] text-white antialiased">
      <SynapTopDock />

      <section className="relative isolate overflow-hidden">
        <ConstellationBackdrop className="absolute inset-0 z-0" hue={180} />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-40 bg-[linear-gradient(180deg,transparent,#07080c)]"
        />

        <div className="relative z-10 mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-[1240px] flex-col items-center justify-center px-6 pb-24 pt-20 text-center">
          <p className="font-mono text-[11px] tracking-[0.34em] text-white/45">学习工作台 · LEARNING WORKBENCH</p>
          <h1 className="mt-7 text-[clamp(46px,9vw,124px)] font-normal">
            <SynapWordmark text="SynapFlow" />
          </h1>
          <p className="mt-8 max-w-xl text-[15px] leading-7 text-white/60">
            把资料、练习和笔记串成一条闭环。今天该复习什么、哪道题该重做，交给系统替你记着。
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <HoloButton href="/login">登录 / 注册</HoloButton>
            <HoloButton href="/knowledge" tone="ghost">
              进入知识库
            </HoloButton>
          </div>
        </div>
      </section>
    </main>
  );
}
