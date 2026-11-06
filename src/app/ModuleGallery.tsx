import type { ModuleDescriptor } from "@/lib/caseApi";
import { MODULE_GROUPS, STATUS_LABELS, moduleMeta } from "@/app/moduleRegistry";

export default function ModuleGallery({
  modules,
  onOpen,
}: {
  modules: ModuleDescriptor[];
  onOpen: (id: string) => void;
}) {
  const groups = MODULE_GROUPS.filter((group) => modules.some((m) => m.category === group.id));
  return (
    <div className="gallery">
      <header className="galleryHero">
        <p className="wbEyebrow">MODULAR CAE TOOLBOX</p>
        <h1>工况创建工具箱</h1>
        <p className="gallerySub">
          选择一个工况模板开始。每个模块独立生成<strong>可增量导入 HyperMesh 的 FEM</strong>，
          整车工况载荷表与新工况共用同一项目与导出管线；后续新模块会持续出现在这里。
        </p>
      </header>

      {groups.map((group) => {
        const list = modules.filter((m) => m.category === group.id);
        return (
          <section key={group.id} className="galleryGroup">
            <div className="galleryGroupHead">
              <h2>{group.label}</h2>
              <span>{group.hint}</span>
            </div>
            <div className="galleryGrid">
              {list.map((m) => {
                const meta = moduleMeta(m.id);
                return (
                  <button key={m.id} type="button" className="moduleCard" onClick={() => onOpen(m.id)}>
                    <div className="moduleCardTop">
                      <span className="moduleIcon">{meta.icon}</span>
                      <span className={"wbBadge " + m.status}>{STATUS_LABELS[m.status] ?? m.status}</span>
                    </div>
                    <h3>{m.title}</h3>
                    <p>{meta.description}</p>
                    <div className="moduleCardTags">
                      {m.capabilityFlags.slice(0, 3).map((flag) => <span key={flag} className="wbChip muted">{flag}</span>)}
                    </div>
                    <span className="moduleCardOpen">打开模块 →</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
