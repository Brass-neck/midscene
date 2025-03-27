/// <reference types="chrome" />

import type { WebUIContext } from '@midscene/web/utils';
import {
  type WorkerRequestGetContext,
  type WorkerRequestSaveContext,
  workerMessageTypes,
} from './utils';

// console-browserify won't work in worker, so we need to use globalThis.console
const console = globalThis.console;

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// cache data between sidepanel and fullscreen playground
const randomUUID = () => {
  return Math.random().toString(36).substring(2, 15);
};
const cacheMap = new Map<string, WebUIContext>();
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { type } = request;
  if (type.includes('fortress')) return;

  switch (type) {
    case workerMessageTypes.SAVE_CONTEXT: {
      const payload: WorkerRequestSaveContext = request.payload;
      const { context } = payload;
      const id = randomUUID();
      cacheMap.set(id, context);
      sendResponse({ id });
      break;
    }
    case workerMessageTypes.GET_CONTEXT: {
      const payload: WorkerRequestGetContext = request.payload;
      const { id } = payload;
      const context = cacheMap.get(id) as WebUIContext;
      if (!context) {
        sendResponse({ error: 'Screenshot not found' });
      } else {
        sendResponse({ context });
      }

      break;
    }
    default:
      console.log('will send response');
      sendResponse({ error: 'Unknown message type' });
      break;
  }
});

// 堡垒部分
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.local.set({ fortressContentLoaded: 0 });
  }
});

let curPort = null as any;
chrome.runtime.onConnectExternal.addListener((port) => {
  console.assert(port.name === "fortress:connect");
  if (port.name === 'fortress:connect') {
    port.onMessage.addListener((data) => {
      const { type } = data;

      if (type === 'installed') {
        port.postMessage({ type: 'installed', data: true });
      }

      curPort = port;
    });
  }
});

let curTabId = null as any;

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  const { type, data } = message;
  console.log('worker script onMessage', message);

  if (type === 'fortress:openurl') {
    const startNode = data?.nodes?.[0];
    const { data: { formData } } = startNode;

    await chrome.tabs.create({
      url: formData?.pageUrl,
      active: true
    }, async (tab) => {
      curTabId = tab.id;

      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id  as any, {
          type: 'fortress:excute',
          data: { uidl: data, tabId: tab.id }
        }, {}, (response) => {
          console.log('debug back fortress:excute response', response);
        });
      }, 3000);
    });
  } else if (type === 'fortress:closeurl') {
    if (data.tabId) {
      chrome.tabs.remove(data.tabId);
    }
  } else if (type === 'fortress:closepreview') {
    curPort && curPort.postMessage({ type: 'previewend', data });
  }
});

chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name === 'fortress:connectcontent') {
    port.onMessage.addListener((res) => {
      const { type, data } = res;

      if (type === 'fortress:updateurl') {
        const startNode = data?.nodes?.[0];
        const { data: { formData } } = startNode;
        chrome.tabs.update(curTabId, {
          url: formData?.pageUrl,
          active: true
        }, async (tab) => {
          curTabId = tab!.id;

          setTimeout(() => {
            chrome.tabs.sendMessage(tab!.id  as any, {
              type: 'fortress:excute',
              data: { uidl: data, tabId: tab!.id, excuteRecord: data?.excuteRecord }
            }, {}, (response) => {
              console.log('debug back fortress:excute response', response);
            });
          }, formData?.delay ? formData?.delay * 1000 : 3000);
        });
      }
    });
  }
});