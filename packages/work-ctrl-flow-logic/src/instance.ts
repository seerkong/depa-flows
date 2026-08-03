/**
 * 流程实例物化 + status 标注视图（用户定稿设计）：
 * - 实例 = 定义 bundle 的冻结拷贝（含脚本），实例终身只从拷贝执行（定义修改不影响在途实例）。
 * - status 是引擎单向标注的视图，快照仍是真源；标注写在节点 { } 属性块里，用文本手术保留定义注释。
 * - 保留视图键：status / iterations / runStatus / tickNo（编译期剔除，见 instant-ctrl-flow compile）。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { NodeAnnotation, NodeViewStatus, TreeViewAnnotation } from 'work-ctrl-flow-contract';

export type { NodeAnnotation, NodeViewStatus, TreeViewAnnotation };

/** 把定义 bundle 递归拷贝为实例目录（冻结） */
export function materializeInstance(definitionDir: string, instanceDir: string): void {
  fs.mkdirSync(path.dirname(instanceDir), { recursive: true });
  fs.cpSync(definitionDir, instanceDir, { recursive: true });
}

const VIEW_ATTR_RE = /\s*(?:status|iterations|runStatus|tickNo)\s*=\s*(?:"[^"]*"|[\w.]+)/g;

/** 移除既往注入的视图键（仅 manifest.xnl 使用；task.space 的 status 是真实 DSL 字段，走 replace 路径） */
export function stripViewAttrs(text: string): string {
  let out = text.replace(VIEW_ATTR_RE, '');
  // 清理注入后可能残留的空属性块 "{ }"（仅当它是我们注入的——定义里不写空块）
  out = out.replace(/\s*\{\s*\}(?=\s*[([>])/g, '');
  return out;
}

const fmt = (v: string | number) => (typeof v === 'number' ? String(v) : `"${v}"`);

/**
 * 在 `<Tag #id` 之后的 { } 属性块头部注入键值（无属性块则新建）。
 * 依赖校验器保证的不变量：树内 #id 唯一。
 */
function injectAttrs(text: string, id: string, entries: Record<string, string | number>): string {
  const pairs = Object.entries(entries)
    .map(([k, v]) => `${k} = ${fmt(v)}`)
    .join(' ');
  if (!pairs) return text;
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(<[\\w.]+\\s+#${esc})(?![\\w.-])`);
  const m = re.exec(text);
  if (!m) return text; // 节点在实例树中不存在（不应发生）——视图尽力而为，不抛错
  let i = m.index + m[0].length;
  // 跳过元数据位 key=value（tree 节点通常没有；容错处理）
  const metaRe = /^\s+[A-Za-z_][\w.]*\s*=\s*(?:"[^"]*"|[\w.]+)/y;
  for (;;) {
    metaRe.lastIndex = i;
    const mm = metaRe.exec(text);
    if (!mm) break;
    i = metaRe.lastIndex;
  }
  const rest = text.slice(i);
  const nextStructural = rest.search(/[{([>]/);
  const ch = rest[nextStructural];
  if (ch === '{') {
    const at = i + nextStructural + 1;
    return text.slice(0, at) + ` ${pairs}` + text.slice(at);
  }
  const at = i + nextStructural;
  return text.slice(0, at) + `{ ${pairs} } ` + text.slice(at);
}

/** 把状态视图写回实例 manifest.xnl（幂等：先剥离旧视图键再注入） */
export function annotateFlowFile(instanceDir: string, view: TreeViewAnnotation): void {
  const file = path.join(instanceDir, 'manifest.xnl');
  if (!fs.existsSync(file)) return;
  let text = stripViewAttrs(fs.readFileSync(file, 'utf8'));
  const flowRoot = /(<(?:WorkCtrlFlow|BPCtrlFlow)(?:\s+#[\w.-]+)?)/.exec(text);
  if (flowRoot) {
    const at = flowRoot.index + flowRoot[0].length;
    const rest = text.slice(at);
    const next = rest.search(/[{([>]/);
    if (rest[next] === '{') {
      const p = at + next + 1;
      text = text.slice(0, p) + ` runStatus = "${view.runStatus}" tickNo = ${view.tickNo}` + text.slice(p);
    } else {
      const p = at + next;
      text = text.slice(0, p) + `{ runStatus = "${view.runStatus}" tickNo = ${view.tickNo} } ` + text.slice(p);
    }
  }
  for (const [id, a] of Object.entries(view.nodes)) {
    const entries: Record<string, string | number> = { status: a.status };
    if (a.iterations !== undefined) entries.iterations = a.iterations;
    text = injectAttrs(text, id, entries);
  }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** BPCtrlFlow：把任务状态机现值同步进实例 task.space.xnl（替换既有 status 值；真源在 TaskSpaceStore） */
export function annotateTaskSpaceFile(instanceDir: string, taskStatuses: Record<string, string>): void {
  const file = path.join(instanceDir, 'task.space.xnl');
  if (!fs.existsSync(file)) return;
  let text = fs.readFileSync(file, 'utf8');
  for (const [id, status] of Object.entries(taskStatuses)) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`(<Task\\s+#${esc}(?![\\w.-])[\\s\\S]*?status\\s*=\\s*")[A-Za-z_]+(")`), `$1${status}$2`);
  }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
