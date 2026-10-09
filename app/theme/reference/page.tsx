import {
  AnimatedTopDock,
  ConstellationField,
  ShaderButtons,
  TextAnimationCollection,
} from '@/components/threeui';

/*
 * Reference mounts — the four ThreeUI components exactly as registered, kept so the
 * borrowed new theme at /theme can be compared against the originals. Nothing here
 * is re-styled or re-worded; the labels document which variant is mounted.
 */

const SPECIMENS = [
  {
    index: '01',
    name: 'AnimatedTopDock',
    variant: 'modern',
    note: '标签在左 · 停靠坞居中 · 操作在右；指针靠近时按弹簧扩张。该变体按宽幅帧设计，窄屏会裁切超出部分',
  },
  {
    index: '02',
    name: 'TextAnimationCollection',
    variant: 'threeui-intro',
    note: '开场字标：色散字体的装配节拍',
  },
  {
    index: '03',
    name: 'ConstellationField',
    variant: 'constellation-field',
    note: '漂移粒子星座网络，连线笔画宽度可调',
  },
  {
    index: '04',
    name: 'ShaderButtons',
    variant: 'star-portal',
    note: '两片漂移星场上的全息胶囊按钮',
  },
] as const;

function SpecimenLabel({ index, name, variant, note }: (typeof SPECIMENS)[number]) {
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pb-3 sm:px-6">
      <span className="font-mono text-[11px] tracking-[0.28em] text-white/35">{index}</span>
      <h2 className="text-sm font-medium text-white/90">{name}</h2>
      <code className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-white/55">
        variant=&quot;{variant}&quot;
      </code>
      <p className="w-full text-xs leading-5 text-white/45 sm:w-auto">{note}</p>
    </div>
  );
}

export default function ThemeReferencePage() {
  return (
    <main className="min-h-screen bg-[#08080a] text-white antialiased">
      <section className="pt-8 sm:pt-12">
        <div className="mx-auto w-full max-w-[1240px] px-4 sm:px-6">
          <p className="font-mono text-[11px] tracking-[0.28em] text-white/35">SYNAPFLOW · THEME REFERENCE</p>
          <h1 className="mt-3 max-w-2xl text-2xl font-semibold leading-9 sm:text-3xl">
            组件原样参照
            <span className="mt-2 block text-sm font-normal leading-6 text-white/50">
              四个 ThreeUI 组件按注册源码与注册 props 原样装配，未改写文案与配色，用于和{' '}
              <a href="/theme" className="text-white/70 underline decoration-white/20 underline-offset-2">
                /theme
              </a>{' '}
              上的新主题对照。
            </span>
          </h1>
        </div>
      </section>

      {SPECIMENS.map((specimen, position) => (
        <section key={specimen.name} className={position === 0 ? 'mt-8 sm:mt-10' : 'mt-14 sm:mt-20'}>
          <SpecimenLabel {...specimen} />
          {specimen.name === 'AnimatedTopDock' && (
            <div className="h-[340px] overflow-hidden sm:h-[440px] lg:aspect-[16/6] lg:h-auto">
              <AnimatedTopDock
                variant="modern"
                proximity={122}
                spring={0.19}
                damping={0.70}
                widthGrowth={17}
                heightGrowth={16}
                drop={3.5}
              />
            </div>
          )}
          {specimen.name === 'TextAnimationCollection' && (
            <div className="h-[520px] overflow-hidden bg-black">
              <TextAnimationCollection variant="threeui-intro" mode="dark" hue={0} saturation={1} brightness={1} />
            </div>
          )}
          {specimen.name === 'ConstellationField' && (
            <div className="h-[520px] overflow-hidden bg-[#0c0c0c]">
              <ConstellationField
                variant="constellation-field"
                mode="dark"
                speed={1.00}
                size={1.00}
                strokeWidth={1.00}
                length={1.00}
                density={1.00}
                opacity={1.00}
                hue={0}
                saturation={1.00}
                brightness={1.00}
              />
            </div>
          )}
          {specimen.name === 'ShaderButtons' && (
            <div className="h-[420px] overflow-hidden bg-[#090909]">
              <ShaderButtons variant="star-portal" mode="dark" hue={0} saturation={1.00} brightness={1.00} />
            </div>
          )}
        </section>
      ))}

      <footer className="mx-auto mt-16 w-full max-w-[1240px] border-t border-white/10 px-4 py-8 text-xs leading-5 text-white/35 sm:px-6">
        组件源码见 components/threeui，来源与校验哈希见该目录 README。
      </footer>
    </main>
  );
}
