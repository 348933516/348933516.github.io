import { useEffect, useRef, useState } from "react";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { Extension, Node } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, Code2, Eraser,
  Highlighter, ImagePlus, Italic, Link2, List, ListOrdered, Maximize2, Minus, Palette,
  Quote, Redo2, Strikethrough, Table2, Underline as UnderlineIcon, Undo2, X
} from "lucide-react";
import { sanitizeHtml } from "../lib/sanitize";

interface RichEditorProps {
  value: string;
  onChange(html: string, text: string, json: Record<string, unknown>): void;
  onUploadImages?: (files: File[]) => Promise<Array<{ src: string; alt: string; caption?: string }>>;
}

const fontOptions = [
  ["default", "默认字体"], ["noto-sans", "Noto 黑体"], ["noto-serif", "Noto 宋体"],
  ["yahei", "微软雅黑"], ["pingfang", "苹方"], ["simsun", "宋体"], ["simhei", "黑体"],
  ["kaiti", "楷体"], ["fangsong", "仿宋"], ["arial", "Arial"], ["georgia", "Georgia"]
];
const sizeOptions = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "22", "24", "26", "28", "32", "36", "42", "48", "56", "64", "72"];
const tableWidths = ["0", "1", "2", "3", "4"];
const themeColors = ["#ffffff", "#d7dee2", "#8d9aa2", "#111d22", "#65e3c2", "#f2cc72", "#ff938d", "#8fc7ff", "#9ee69b", "#d89cff"];
const tintColors = ["#fee2e2", "#ffedd5", "#fef9c3", "#dcfce7", "#ccfbf1", "#dbeafe", "#ede9fe", "#fce7f3", "#334155", "#0f172a"];
const standardColors = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e", "#06b6d4", "#3b82f6", "#1d4ed8", "#7c3aed", "#db2777"];

function normalizeHex(value?: string | null) {
  const input = (value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(input) ? input.toLowerCase() : "";
}

function cssColor(value?: string | null) {
  const tokenMap: Record<string, string> = {
    teal: "#65e3c2", gold: "#f2cc72", red: "#ff938d", blue: "#8fc7ff", green: "#9ee69b", muted: "#8d9aa2"
  };
  return normalizeHex(value) || tokenMap[String(value || "").toLowerCase()] || "";
}

function clampFontSize(value: string) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return "";
  return String(Math.min(72, Math.max(8, numeric)));
}

const ControlledFontFamily = FontFamily.extend({
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        fontFamily: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-font-family"),
          renderHTML: (attributes) => attributes.fontFamily ? { "data-font-family": attributes.fontFamily } : {}
        }
      }
    }];
  }
});

const ControlledColor = Color.extend({
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        color: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-text-color") || element.style.color,
          renderHTML: (attributes) => {
            const color = cssColor(attributes.color);
            return color ? { "data-text-color": color, style: `color: ${color}` } : {};
          }
        }
      }
    }];
  }
});

const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [{
      types: ["textStyle"],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-font-size") || element.style.fontSize.replace("px", ""),
          renderHTML: (attributes) => {
            const size = clampFontSize(String(attributes.fontSize || ""));
            return size ? { "data-font-size": size, style: `font-size: ${size}px` } : {};
          }
        }
      }
    }];
  }
});

const ControlledHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-highlight") || element.style.backgroundColor,
        renderHTML: (attributes) => {
          const color = cssColor(attributes.color);
          return color ? { "data-highlight": color, style: `background-color: ${color}` } : {};
        }
      }
    };
  }
}).configure({ multicolor: true });

const FigureImage = Node.create({
  name: "figureImage",
  group: "block",
  content: "inline*",
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: "" },
      alt: { default: "" }
    };
  },
  parseHTML() {
    return [{
      tag: "figure[data-editor-image]",
      getAttrs: (element) => {
        const image = (element as HTMLElement).querySelector("img");
        return { src: image?.getAttribute("src") || "", alt: image?.getAttribute("alt") || "" };
      }
    }];
  },
  renderHTML({ node }) {
    return ["figure", { "data-editor-image": "true" }, ["img", { src: node.attrs.src, alt: node.attrs.alt || "" }], ["figcaption", 0]];
  }
});

const StyledTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      borderWidth: {
        default: "1",
        parseHTML: (element) => element.getAttribute("data-table-border") || "1",
        renderHTML: (attributes) => ({ "data-table-border": attributes.borderWidth || "1" })
      },
      borderStyle: {
        default: "solid",
        parseHTML: (element) => element.getAttribute("data-table-style") || "solid",
        renderHTML: (attributes) => ({ "data-table-style": attributes.borderStyle || "solid" })
      },
      borderColor: {
        default: "#2b3a40",
        parseHTML: (element) => element.getAttribute("data-table-color") || "#2b3a40",
        renderHTML: (attributes) => ({ "data-table-color": cssColor(attributes.borderColor) || "#2b3a40" })
      }
    };
  }
});

const cellAttributes = {
  background: {
    default: "none",
    parseHTML: (element: HTMLElement) => element.getAttribute("data-cell-background") || "none",
    renderHTML: (attributes: Record<string, string>) => ({ "data-cell-background": attributes.background || "none" })
  },
  align: {
    default: "left",
    parseHTML: (element: HTMLElement) => element.getAttribute("data-cell-align") || "left",
    renderHTML: (attributes: Record<string, string>) => ({ "data-cell-align": attributes.align || "left" })
  }
};

const StyledTableCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttributes }; } });
const StyledTableHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttributes }; } });

function ToolButton({ title, active = false, disabled = false, onClick, children }: { title: string; active?: boolean; disabled?: boolean; onClick(): void; children: React.ReactNode }) {
  return <button type="button" className={active ? "active" : ""} title={title} aria-label={title} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</button>;
}

function ColorPanel({ title, value, onChange, icon }: { title: string; value: string; onChange(value: string): void; icon: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(normalizeHex(value) || "#65e3c2");
  const swatches = [...themeColors, ...tintColors, ...standardColors];
  return <div className="color-panel-wrap">
    <button type="button" className="color-panel-trigger" title={title} aria-label={title} onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen((current) => !current)}>
      {icon}<span style={{ background: cssColor(value) || "transparent" }} /><ChevronDown />
    </button>
    {open && <div className="color-panel" role="dialog" aria-label={title}>
      <button type="button" className="color-default" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); setOpen(false); }}>默认</button>
      <div className="swatch-grid">{swatches.map((color) => <button type="button" key={color} title={color} style={{ background: color }} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(color); setOpen(false); }} />)}</div>
      <label className="custom-color-row"><span>更多颜色</span><input type="color" value={custom} onChange={(event) => setCustom(event.target.value)} /><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(custom); setOpen(false); }}>应用</button></label>
    </div>}
  </div>;
}

export function RichEditor({ value, onChange, onUploadImages }: RichEditorProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const internalHtml = useRef(sanitizeHtml(value));
  const [tableToolsOpen, setTableToolsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [message, setMessage] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      ControlledFontFamily,
      ControlledColor,
      FontSize,
      ControlledHighlight,
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ allowBase64: false }),
      FigureImage,
      StyledTable.configure({ resizable: true }),
      TableRow,
      StyledTableHeader,
      StyledTableCell
    ],
    content: internalHtml.current,
    editorProps: {
      attributes: { class: "editor-surface" },
      transformPastedHTML: (html) => sanitizeHtml(html)
    },
    onUpdate({ editor: current }) {
      const html = sanitizeHtml(current.getHTML());
      internalHtml.current = html;
      onChange(html, current.getText(), current.getJSON() as Record<string, unknown>);
    },
    onSelectionUpdate({ editor: current }) {
      if (current.isActive("table")) setTableToolsOpen(true);
    }
  });

  useEffect(() => {
    const external = sanitizeHtml(value);
    if (!editor || external === internalHtml.current) return;
    internalHtml.current = external;
    editor.commands.setContent(external, false);
  }, [editor, value]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!shellRef.current?.contains(event.target as globalThis.Node)) setTableToolsOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!editor) return <div className="editor-surface">编辑器加载中...</div>;

  const textStyle = editor.getAttributes("textStyle");
  const tableAttributes = editor.getAttributes("table");
  const cell = editor.getAttributes("tableCell");
  const header = editor.getAttributes("tableHeader");
  const cellStyle = Object.keys(cell).length ? cell : header;
  const headingValue = ([1, 2, 3, 4] as const).find((level) => editor.isActive("heading", { level }));
  const currentSize = clampFontSize(String(textStyle.fontSize || "16")) || "16";
  const canUseTable = editor.isActive("table");

  const setBlock = (next: string) => {
    const chain = editor.chain().focus();
    if (next === "paragraph") chain.setParagraph().run();
    else chain.setHeading({ level: Number(next.slice(1)) as 1 | 2 | 3 | 4 }).run();
  };
  const setLink = () => {
    const previous = editor.getAttributes("link").href || "https://";
    const url = window.prompt("输入链接地址", previous);
    if (!url) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: url, target: "_blank", rel: "noreferrer" }).run();
  };
  const setSize = (size: string) => {
    const next = clampFontSize(size);
    if (next) editor.chain().focus().setMark("textStyle", { fontSize: next }).run();
  };
  const setColor = (color: string) => color ? editor.chain().focus().setColor(color).run() : editor.chain().focus().unsetColor().run();
  const setHighlight = (color: string) => color ? editor.chain().focus().setHighlight({ color }).run() : editor.chain().focus().unsetHighlight().run();
  const insertImages = async (files: File[]) => {
    if (!files.length) return;
    if (!onUploadImages) return setMessage("当前页面没有开启正文图片上传。");
    setUploadingImages(true); setMessage(`正在上传 ${files.length} 张图片...`);
    try {
      const uploaded = await onUploadImages(files);
      editor.chain().focus().insertContent(uploaded.flatMap((image) => [
        { type: "figureImage", attrs: { src: image.src, alt: image.alt }, content: image.caption ? [{ type: "text", text: image.caption }] : [] },
        { type: "paragraph" }
      ])).run();
      setMessage(`已插入 ${uploaded.length} 张图片。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片上传失败。");
    } finally {
      setUploadingImages(false);
    }
  };
  const updateTable = (patch: Record<string, string>) => {
    if (!canUseTable) return;
    editor.chain().focus().updateAttributes("table", patch).run();
    setTableToolsOpen(true);
  };

  return (
    <div ref={shellRef} className={`editor-shell${fullscreen ? " editor-fullscreen" : ""}`}>
      <input ref={fileRef} className="sr-only" type="file" accept="image/*" multiple onChange={(event) => { insertImages([...(event.target.files || [])]); event.target.value = ""; }} />
      <div className="editor-toolbar" aria-label="正文编辑工具">
        <div className="editor-ribbon-group">
          <span>编辑</span>
          <ToolButton title="撤销" onClick={() => editor.chain().focus().undo().run()}><Undo2 /></ToolButton>
          <ToolButton title="重做" onClick={() => editor.chain().focus().redo().run()}><Redo2 /></ToolButton>
          <ToolButton title="全屏编辑" active={fullscreen} onClick={() => setFullscreen((current) => !current)}><Maximize2 /></ToolButton>
        </div>
        <div className="editor-ribbon-group typography-group">
          <span>字体</span>
          <select aria-label="段落格式" value={headingValue ? `h${headingValue}` : "paragraph"} onChange={(event) => setBlock(event.target.value)}><option value="paragraph">正文</option><option value="h1">标题 1</option><option value="h2">标题 2</option><option value="h3">标题 3</option><option value="h4">标题 4</option></select>
          <select aria-label="字体" value={textStyle.fontFamily || "default"} onChange={(event) => event.target.value === "default" ? editor.chain().focus().unsetFontFamily().run() : editor.chain().focus().setFontFamily(event.target.value).run()}>{fontOptions.map(([optionValue, label]) => <option value={optionValue} key={optionValue}>{label}</option>)}</select>
          <select aria-label="字号" value={sizeOptions.includes(currentSize) ? currentSize : "16"} onChange={(event) => setSize(event.target.value)}>{sizeOptions.map((size) => <option value={size} key={size}>{size}px</option>)}</select>
          <input aria-label="自定义字号" type="number" min="8" max="72" value={currentSize} onChange={(event) => setSize(event.target.value)} />
          <ToolButton title="加粗" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></ToolButton>
          <ToolButton title="斜体" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></ToolButton>
          <ToolButton title="下划线" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon /></ToolButton>
          <ToolButton title="删除线" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough /></ToolButton>
          <ColorPanel title="文字颜色" value={textStyle.color || ""} onChange={setColor} icon={<Palette />} />
          <ColorPanel title="背景高亮" value={editor.getAttributes("highlight").color || ""} onChange={setHighlight} icon={<Highlighter />} />
        </div>
        <div className="editor-ribbon-group">
          <span>段落</span>
          <ToolButton title="左对齐" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft /></ToolButton>
          <ToolButton title="居中" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter /></ToolButton>
          <ToolButton title="右对齐" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight /></ToolButton>
          <ToolButton title="两端对齐" active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()}><AlignJustify /></ToolButton>
          <ToolButton title="无序列表" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></ToolButton>
          <ToolButton title="编号列表" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></ToolButton>
          <ToolButton title="引用" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote /></ToolButton>
          <ToolButton title="代码块" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code2 /></ToolButton>
        </div>
        <div className="editor-ribbon-group">
          <span>插入</span>
          <ToolButton title="分隔线" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus /></ToolButton>
          <ToolButton title="链接" active={editor.isActive("link")} onClick={setLink}><Link2 /></ToolButton>
          <ToolButton title="上传本地图片" disabled={uploadingImages} onClick={() => fileRef.current?.click()}><ImagePlus /></ToolButton>
          <ToolButton title="插入表格" onClick={() => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); setTableToolsOpen(true); }}><Table2 /></ToolButton>
          <ToolButton title="清除选区格式" onClick={() => editor.chain().focus().unsetAllMarks().run()}><Eraser /></ToolButton>
        </div>
        {tableToolsOpen && <div className="editor-table-tools" aria-label="表格工具">
          <strong>表格</strong>
          <button type="button" disabled={!canUseTable} onClick={() => editor.chain().focus().addRowBefore().run()}>上方加行</button><button type="button" disabled={!canUseTable} onClick={() => editor.chain().focus().addRowAfter().run()}>下方加行</button><button type="button" disabled={!canUseTable} onClick={() => editor.chain().focus().deleteRow().run()}>删除行</button>
          <button type="button" disabled={!canUseTable} onClick={() => editor.chain().focus().addColumnBefore().run()}>左侧加列</button><button type="button" disabled={!canUseTable} onClick={() => editor.chain().focus().addColumnAfter().run()}>右侧加列</button><button type="button" disabled={!canUseTable} onClick={() => editor.chain().focus().deleteColumn().run()}>删除列</button>
          <button type="button" disabled={!canUseTable} onClick={() => editor.chain().focus().mergeCells().run()}>合并单元格</button><button type="button" disabled={!canUseTable} onClick={() => editor.chain().focus().splitCell().run()}>拆分单元格</button><button type="button" disabled={!canUseTable} onClick={() => editor.chain().focus().toggleHeaderRow().run()}>切换表头</button>
          <label>线宽<select value={tableAttributes.borderWidth || "1"} disabled={!canUseTable} onChange={(event) => updateTable({ borderWidth: event.target.value })}>{tableWidths.map((width) => <option value={width} key={width}>{width}px</option>)}</select></label>
          <label>线型<select value={tableAttributes.borderStyle || "solid"} disabled={!canUseTable} onChange={(event) => updateTable({ borderStyle: event.target.value })}><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label>
          <label>线色<input type="color" value={cssColor(tableAttributes.borderColor) || "#2b3a40"} disabled={!canUseTable} onChange={(event) => updateTable({ borderColor: event.target.value })} /></label>
          <label>单元格背景<select value={cellStyle.background || "none"} disabled={!canUseTable} onChange={(event) => editor.chain().focus().setCellAttribute("background", event.target.value).run()}><option value="none">无</option><option value="surface">深色</option><option value="teal">青绿</option><option value="gold">金色</option><option value="red">红色</option><option value="blue">蓝色</option><option value="green">绿色</option></select></label>
          <label>单元格对齐<select value={cellStyle.align || "left"} disabled={!canUseTable} onChange={(event) => editor.chain().focus().setCellAttribute("align", event.target.value).run()}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option><option value="justify">两端对齐</option></select></label>
          <button type="button" disabled={!canUseTable} onClick={() => updateTable({ borderWidth: "1", borderStyle: "solid", borderColor: "#2b3a40" })}>清除表格样式</button>
          <button className="danger" type="button" disabled={!canUseTable} onClick={() => editor.chain().focus().deleteTable().run()}>删除表格</button>
          <button className="icon-only" type="button" aria-label="收起表格工具" onClick={() => setTableToolsOpen(false)}><X /></button>
        </div>}
      </div>
      {message && <div className="editor-message">{message}</div>}
      <EditorContent editor={editor} />
    </div>
  );
}
