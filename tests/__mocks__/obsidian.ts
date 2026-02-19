import type { Plugin, PluginSettingTab, Modal, Notice, Setting, MarkdownView, Editor, TFile, App as ObsidianApp } from 'obsidian';

const jestFn = () => {
  const fn: any = (...args: any[]) => fn._impl(...args);
  fn._impl = () => {};
  fn.mockReturnThis = () => { fn._impl = () => fn; return fn; };
  fn.mockReturnValue = (val: any) => { fn._impl = () => val; return fn; };
  fn.mockResolvedValue = (val: any) => { fn._impl = () => Promise.resolve(val); return fn; };
  return fn;
};

export class App {
  workspace = {
    on: jestFn(),
    getActiveViewOfType: jestFn(),
    containerEl: { createEl: jestFn() }
  };
  
  vault = {
    read: jestFn(),
    modify: jestFn()
  };
}

export class PluginImpl {
  app: App;
  
  constructor() {
    this.app = new App();
  }
  
  addCommand = jestFn();
  addSettingTab = jestFn();
  registerEvent = jestFn();
  registerDomEvent = jestFn();
  loadData = jestFn().mockResolvedValue({});
  saveData = jestFn().mockResolvedValue(undefined);
  addStatusBarItem = jestFn().mockReturnValue({ setText: jestFn() });
}

export { PluginImpl as Plugin };

export class PluginSettingTabImpl {
  app: App;
  containerEl: any;
  
  constructor(app: App, _plugin: PluginImpl) {
    this.app = app;
    this.containerEl = {
      empty: jestFn(),
      createEl: jestFn(() => ({
        style: {},
        onclick: null
      })),
      createDiv: jestFn(() => ({
        createEl: jestFn(),
        style: {}
      }))
    };
  }
}

export { PluginSettingTabImpl as PluginSettingTab };

export class ModalImpl {
  app: App;
  contentEl: any;
  
  constructor(app: App) {
    this.app = app;
    this.contentEl = {
      empty: jestFn(),
      createEl: jestFn(() => ({
        style: {},
        onclick: null
      })),
      createDiv: jestFn(() => ({
        createEl: jestFn(() => ({
          style: {},
          onclick: null
        })),
        style: {}
      }))
    };
  }
  
  open = jestFn();
  close = jestFn();
}

export { ModalImpl as Modal };

export class NoticeImpl {
  message: string;
  
  constructor(message: string) {
    this.message = message;
  }
}

export { NoticeImpl as Notice };

export class SettingImpl {
  constructor(_containerEl: any) {}
  
  setName = jestFn().mockReturnThis();
  setDesc = jestFn().mockReturnThis();
  addText = jestFn().mockReturnThis();
  addToggle = jestFn().mockReturnThis();
  addDropdown = jestFn().mockReturnThis();
  addSlider = jestFn().mockReturnThis();
  addButton = jestFn().mockReturnThis();
}

export { SettingImpl as Setting };

export class MarkdownViewImpl {
  editor: any;
  
  constructor(editor: any = {}) {
    this.editor = editor;
  }
}

export { MarkdownViewImpl as MarkdownView };

export class EditorImpl {
  getValue = jestFn().mockReturnValue('');
  setValue = jestFn();
  getSelection = jestFn().mockReturnValue('');
  replaceSelection = jestFn();
  getCursor = jestFn().mockReturnValue({ line: 0, ch: 0 });
  setCursor = jestFn();
  getRange = jestFn().mockReturnValue('');
  replaceRange = jestFn();
  getLine = jestFn().mockReturnValue('');
  posToOffset = jestFn().mockReturnValue(0);
  offsetToPos = jestFn().mockReturnValue({ line: 0, ch: 0 });
}

export { EditorImpl as Editor };

export class TFileImpl {
  path: string;
  
  constructor(path: string = 'test.md') {
    this.path = path;
  }
}

export { TFileImpl as TFile };
