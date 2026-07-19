import { useEffect } from "react";
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
import { Extension } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Code2, Eraser, Highlighter,
  ImagePlus, Italic, Link2, List, ListOrdered, Minus, Palette, Quote, Redo2, Strikethrough,
  Table2, Underline as UnderlineIcon, Undo2
} from "lucide-react";
import { sanitizeHtml } from "../lib/sanitize";

interface RichEditorProps {
  value: string;
  onChange(html: string, text: string, json: Record<string, unknown>): void;
}

const fontOptions = [
  ["default", "默认字体"], ["noto-sans", "Noto 黑体"], ["noto-serif", "Noto 宋体"],
  ["yahei", "微软雅黑"], ["pingfang", "苹方"], ["simsun", "宋体"], ["simhei", "黑体"],
  ["kaiti", "楷体"], ["fangsong", "仿宋"], ["arial", "Arial"], ["georgia", "Georgia"]
];
const sizeOptions = ["12", "14", "16", "18", "20", "24", "28", "32", "36"];
const colorOptions = [["default", "默认颜色"], ["teal", "青绿"], ["gold", "金色"], ["red", "红色"], ["blue", "蓝色"], ["green", "绿色"], ["muted", "灰色"]];
const highlightOptions = [["", "无高亮"], ["teal", "青绿高亮"], ["gold", "金色高亮"], ["red", "红色高亮"], ["blue", "蓝色高亮"], ["green", "绿色高亮"]];

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
          parseHTML: (element) => element.getAttribute("data-text-color"),
          renderHTML: (attributes) => attributes.color ? { "data-text-color": attributes.color } : {}
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
          parseHTML: (element) => element.getAttribute("data-font-size"),
          renderHTML: (attributes) => attributes.fontSize ? { "data-font-size": attributes.fontSize } : {}
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
        parseHTML: (element) => element.getAttribute("data-highlight"),
        renderHTML: (attributes) => attributes.color ? { "data-highlight": attributes.color } : {}
      }
    };
  }
}).configure({ multicolor: true });

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
  return <button type="button" className={active ? "active" : ""} title={title} aria-label={title} disabled={disabled} onClick={onClick}>{children}</button>;
}

export function RichEditor({ value, onChange }: RichEditorProps) {
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
      StyledTable.configure({ resizable: true }),
      TableRow,
      StyledTableHeader,
      StyledTableCell
    ],
    content: sanitizeHtml(value),
    editorProps: { attributes: { class: "editor-surface" } },
    onUpdate({ editor: current }) {
      onChange(sanitizeHtml(current.getHTML()), current.getText(), current.getJSON() as Record<string, unknown>);
    }
  });

  useEffect(() => {
    if (!editor || editor.getHTML() === value) return;
    editor.commands.setContent(sanitizeHtml(value), false);
  }, [editor, value]);

  if (!editor) return <div className="editor-surface">编辑器加载中...</div>;

  const setLink = () => {
    const previous = editor.getAttributes("link").href || "https://";
    const url = window.prompt("输入链接地址", previous);
    if (!url) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: url, target: "_blank", rel: "noreferrer" }).run();
  };
  const setImage = () => {
    const src = window.prompt("输入已上传图片的 HTTPS 地址");
    if (src) editor.chain().focus().setImage({ src }).run();
  };
  const setBlock = (value: string) => {
    const chain = editor.chain().focus();
    if (value === "paragraph") chain.setParagraph().run();
    else chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 | 4 }).run();
  };
  const headingValue = ([1, 2, 3, 4] as const).find((level) => editor.isActive("heading", { level }));
  const textStyle = editor.getAttributes("textStyle");
  const tableAttributes = editor.getAttributes("table");
  const cell = editor.getAttributes("tableCell");
  const header = editor.getAttributes("tableHeader");
  const cellStyle = Object.keys(cell).length ? cell : header;

  return (
    <div className="editor-shell">
      <div className="editor-toolbar" aria-label="正文编辑工具">
        <div className="editor-toolbar-row primary-tools">
          <ToolButton title="撤销" onClick={() => editor.chain().focus().undo().run()}><Undo2 /></ToolButton>
          <ToolButton title="重做" onClick={() => editor.chain().focus().redo().run()}><Redo2 /></ToolButton>
          <span />
          <select aria-label="段落格式" value={headingValue ? `h${headingValue}` : "paragraph"} onChange={(event) => setBlock(event.target.value)}><option value="paragraph">正文</option><option value="h1">标题 1</option><option value="h2">标题 2</option><option value="h3">标题 3</option><option value="h4">标题 4</option></select>
          <select aria-label="字体" value={textStyle.fontFamily || "default"} onChange={(event) => event.target.value === "default" ? editor.chain().focus().unsetFontFamily().run() : editor.chain().focus().setFontFamily(event.target.value).run()}>{fontOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <select aria-label="字号" value={textStyle.fontSize || "16"} onChange={(event) => editor.chain().focus().setMark("textStyle", { fontSize: event.target.value }).run()}>{sizeOptions.map((size) => <option value={size} key={size}>{size}px</option>)}</select>
          <span />
          <ToolButton title="加粗" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></ToolButton>
          <ToolButton title="斜体" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></ToolButton>
          <ToolButton title="下划线" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon /></ToolButton>
          <ToolButton title="删除线" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough /></ToolButton>
          <label className="toolbar-select-icon" title="文字颜色"><Palette /><select aria-label="文字颜色" value={textStyle.color || "default"} onChange={(event) => event.target.value === "default" ? editor.chain().focus().unsetColor().run() : editor.chain().focus().setColor(event.target.value).run()}>{colorOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label className="toolbar-select-icon" title="背景高亮"><Highlighter /><select aria-label="背景高亮" value={editor.getAttributes("highlight").color || ""} onChange={(event) => event.target.value ? editor.chain().focus().setHighlight({ color: event.target.value }).run() : editor.chain().focus().unsetHighlight().run()}>{highlightOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        </div>
        <div className="editor-toolbar-row secondary-tools">
          <ToolButton title="左对齐" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft /></ToolButton>
          <ToolButton title="居中" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter /></ToolButton>
          <ToolButton title="右对齐" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight /></ToolButton>
          <ToolButton title="两端对齐" active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()}><AlignJustify /></ToolButton>
          <span />
          <ToolButton title="无序列表" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></ToolButton>
          <ToolButton title="编号列表" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></ToolButton>
          <ToolButton title="引用" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote /></ToolButton>
          <ToolButton title="代码块" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code2 /></ToolButton>
          <ToolButton title="分隔线" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus /></ToolButton>
          <ToolButton title="链接" active={editor.isActive("link")} onClick={setLink}><Link2 /></ToolButton>
          <ToolButton title="图片" onClick={setImage}><ImagePlus /></ToolButton>
          <ToolButton title="插入表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 /></ToolButton>
          <ToolButton title="清除格式" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><Eraser /></ToolButton>
        </div>
        {editor.isActive("table") && <div className="editor-table-tools" aria-label="表格工具">
          <strong>表格</strong>
          <button type="button" onClick={() => editor.chain().focus().addRowBefore().run()}>上方加行</button><button type="button" onClick={() => editor.chain().focus().addRowAfter().run()}>下方加行</button><button type="button" onClick={() => editor.chain().focus().deleteRow().run()}>删除行</button>
          <button type="button" onClick={() => editor.chain().focus().addColumnBefore().run()}>左侧加列</button><button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()}>右侧加列</button><button type="button" onClick={() => editor.chain().focus().deleteColumn().run()}>删除列</button>
          <button type="button" onClick={() => editor.chain().focus().mergeCells().run()}>合并单元格</button><button type="button" onClick={() => editor.chain().focus().splitCell().run()}>拆分单元格</button><button type="button" onClick={() => editor.chain().focus().toggleHeaderRow().run()}>切换表头</button>
          <label>线宽<select value={tableAttributes.borderWidth || "1"} onChange={(event) => editor.chain().focus().updateAttributes("table", { borderWidth: event.target.value }).run()}>{[0, 1, 2, 3, 4].map((width) => <option value={String(width)} key={width}>{width}px</option>)}</select></label>
          <label>线型<select value={tableAttributes.borderStyle || "solid"} onChange={(event) => editor.chain().focus().updateAttributes("table", { borderStyle: event.target.value }).run()}><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label>
          <label>单元格背景<select value={cellStyle.background || "none"} onChange={(event) => editor.chain().focus().setCellAttribute("background", event.target.value).run()}><option value="none">无</option><option value="surface">深色</option><option value="teal">青绿</option><option value="gold">金色</option><option value="red">红色</option><option value="blue">蓝色</option><option value="green">绿色</option></select></label>
          <label>单元格对齐<select value={cellStyle.align || "left"} onChange={(event) => editor.chain().focus().setCellAttribute("align", event.target.value).run()}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option><option value="justify">两端对齐</option></select></label>
          <button className="danger" type="button" onClick={() => editor.chain().focus().deleteTable().run()}>删除表格</button>
        </div>}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
