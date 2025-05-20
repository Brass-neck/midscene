/// <reference types="chrome" />

import type { WebUIContext } from '@midscene/web/utils';
import {
  type WorkerRequestGetContext,
  type WorkerRequestSaveContext,
  workerMessageTypes,
} from './utils';

// console-browserify won't work in worker, so we need to use globalThis.console
const { console } = globalThis;

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// cache data between sidepanel and fullscreen playground
const randomUUID = () => Math.random().toString(36).substring(2, 15);
const cacheMap = new Map<string, WebUIContext>();
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { type } = request;
  if (type.includes('fortress')) {
    return;
  }

  switch (type) {
    case workerMessageTypes.SAVE_CONTEXT: {
      const { payload } = request;
      const { context } = payload;
      const id = randomUUID();
      cacheMap.set(id, context);
      sendResponse({ id });
      break;
    }
    case workerMessageTypes.GET_CONTEXT: {
      const { payload } = request;
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
  console.assert(port.name === 'fortress:connect');
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
let originalCookies: chrome.cookies.Cookie[] = [];

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  const { type, data } = message;
  console.log('worker script onMessage', message);

  if (type === 'fortress:openurl') {
    const startNode = data?.nodes?.[0];
    const {
      data: { formData },
    } = startNode;

    await chrome.tabs.create(
      {
        url: formData?.pageUrl,
        active: true,
      },
      async (tab) => {
        curTabId = tab.id;

        setTimeout(() => {
          chrome.tabs.sendMessage(
            tab.id as any,
            {
              type: 'fortress:excute',
              data: { uidl: data, tabId: tab.id },
            },
            {},
            (response) => {
              console.log('debug back fortress:excute response', response);
            },
          );
        }, 3000);
      },
    );
  } else if (type === 'fortress:closeurl') {
    if (data.tabId) {
      chrome.tabs.remove(data.tabId);
    }
  } else if (type === 'fortress:closepreview') {
    curPort?.postMessage({ type: 'previewend', data });
  }
  return true;
});

let sidepanelPort = null as any;
chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name === 'fortress:sidepanel') {
    sidepanelPort = port;
    port.onMessage.addListener((res) => {
      const { type, data } = res;
      if (type === 'fortress:excuteAINode') {
        chrome.tabs.sendMessage(curTabId as any, {
          type: 'fortress:AINodeDone',
          data,
        });
        if (data.AINodeNum === 0) {
          sidepanelPort.disconnect();
          sidepanelPort = null;
        }
      }
    });
  }
});

const getCurrentTabInfo = async (tabId: number): Promise<chrome.tabs.Tab> =>
  new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (tab) {
        console.log('debug getCurrentTabInfo Tab found', tab);
        resolve(tab);
      } else {
        console.log('debug getCurrentTabInfo Tab not found');
        reject(new Error('Tab not found'));
      }
    });
  });
function saveCookies(url: string): Promise<chrome.cookies.Cookie[]> {
  return new Promise((resolve, reject) => {
    chrome.cookies.getAll({ url }, (cookies) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(cookies);
      }
    });
  });
}
// 修改Cookie
function modifyCookies(
  url: string,
  modifications: { name: string; value: string; domain: string }[],
) {
  modifications.forEach((modification) => {
    chrome.cookies.set(
      {
        url,
        name: modification.name,
        value: modification.value,
        domain: modification.domain,
        expirationDate: new Date().getTime() / 1000 + 3600, // 设置1小时后过期
      },
      (cookie) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError);
        } else {
          console.log('Cookie modified successfully: ', cookie);
        }
      },
    );
  });
}
// 恢复Cookie
function restoreCookies(url: string, originalCookies: chrome.cookies.Cookie[]) {
  originalCookies.forEach((cookie) => {
    chrome.cookies.set(
      {
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        expirationDate: cookie.expirationDate,
      },
      (cookie) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError);
        } else {
          console.log('Cookie restored successfully: ', cookie);
        }
      },
    );
  });
}

chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name === 'fortress:connectcontent') {
    port.onMessage.addListener(async (res) => {
      const { type, data } = res;
      if (type === 'fortress:updateurl') {
        const startNode = data?.nodes?.[0];
        const {
          data: { formData },
        } = startNode;
        chrome.tabs.update(
          curTabId,
          {
            url: formData?.pageUrl,
            active: true,
          },
          async (tab) => {
            curTabId = tab!.id;

            setTimeout(
              () => {
                chrome.tabs.sendMessage(
                  tab!.id as any,
                  {
                    type: 'fortress:excute',
                    data: {
                      uidl: data,
                      tabId: tab!.id,
                      excuteRecord: data?.excuteRecord,
                    },
                  },
                  {},
                  (response) => {
                    console.log(
                      'debug back fortress:excute response',
                      response,
                    );
                  },
                );
              },
              formData?.delay ? formData?.delay * 1000 : 3000,
            );
          },
        );
      }
      if (type === 'fortress:excuteAINode') {
        sidepanelPort?.postMessage(res);
      }
      if (type === 'fortress:updatecookie') {
        const { cookieKey, cookieValue } = res.data;
        const curTab = await getCurrentTabInfo(curTabId);
        const curTabPageUrl = curTab?.url;
        console.log(
          'debug fortress:updateurl curTabId',
          curTabPageUrl,
          curTabId,
        );
        if (!curTabPageUrl) {
          return;
        }
        // 暂存Cookie
        saveCookies(curTabPageUrl)
          .then((cookies) => {
            originalCookies = cookies;
            console.log('Cookies saved:', originalCookies);
            const domain =
              curTabPageUrl.match(
                /[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,6}/,
              )?.[0] ?? '';
            // 修改Cookie
            modifyCookies(curTabPageUrl, [
              { name: cookieKey, value: cookieValue, domain },
            ]);
          })
          .catch((error) => {
            console.error('Error saving cookies:', error);
          });
      }
      if (type === 'fortress:resetcookie') {
        console.log('debug fortress:resetcookie curTabId', curTabId);
        const curTab = await getCurrentTabInfo(curTabId);
        const curTabPageUrl = curTab?.url;
        if (!curTabPageUrl) {
          return;
        }
        restoreCookies(curTabPageUrl, originalCookies);
      }
    });
  }
});
