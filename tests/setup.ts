export {};

(global as any).fetch = jest.fn();

(global as any).document = {
  createElement: jest.fn(() => ({
    className: '',
    style: { cssText: '' },
    title: '',
    innerHTML: '',
    textContent: '',
    setAttribute: jest.fn(),
    addEventListener: jest.fn(),
    appendChild: jest.fn(),
    parentNode: null,
  })),
  body: {
    appendChild: jest.fn(),
    removeChild: jest.fn(),
    contains: jest.fn(() => false),
    addEventListener: jest.fn(),
  },
  addEventListener: jest.fn(),
};

(global as any).HTMLDivElement = class HTMLDivElement {
  contains = jest.fn(() => false);
};
