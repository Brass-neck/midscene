/// <reference types="chrome" />

import type { WebUIContext } from '@midscene/web/utils';
import {
  type WorkerRequestGetContext,
  type WorkerRequestSaveContext,
  workerMessageTypes,
} from './utils';
import { sleep } from '@midscene/core/utils';

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
  console.log(`Connected by external extension with port name: ${port.name}`);
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
let curWindowId = null as any;
let originalCookies: chrome.cookies.Cookie[] = [];

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  const { type, data } = message;
  console.log('worker script onMessage', message);

  if (type === 'fortress:openurl') {
    const oldStartNode = data?.nodes?.find(
      (i: any) => i.type === 'oldStartNode',
    );
    const oldPageUrl = oldStartNode?.data?.formData?.pageUrl;
    const jumpUrlNode = data?.nodes?.find((i: any) => i.type === 'jumpUrlNode');
    const jumpUrlNodeUrl = jumpUrlNode?.data?.formData?.pageUrl;
    const dynamicUrlFetchNode = data?.nodes?.find(
      (i: any) => i.type === 'urlDynamicFetchNode',
    );
    const deviceNode = data?.nodes?.find((i: any) => i.type === 'deviceNode');
    let pageUrl = oldPageUrl || jumpUrlNodeUrl;
    if (dynamicUrlFetchNode) {
      // 本地预览时，由于空页面无法执行动态链接获取请求，故需要跳转到一个非空页面
      pageUrl = 'https://www.baidu.com';
    }
    const isMobileDevice = deviceNode && deviceNode.data?.formData;
    if (isMobileDevice) {
      const deviceFormData = deviceNode?.data?.formData;
      const width = deviceFormData?.width || 375;
      const height = deviceFormData?.height || 667;
      await chrome.windows.create(
        {
          url: pageUrl,
          type: 'normal',
          width: width,
          height: height,
        },
        async (newWindow) => {
          curWindowId = newWindow?.id;
          // 获取并检查实际大小
          chrome.windows.get(curWindowId, (windowInfo) => {
            let actualWidth = windowInfo.width;
            let actualHeight = windowInfo.height;
            // 如果尺寸不匹配，进行调整
            if (actualWidth !== width || actualHeight !== height) {
              chrome.windows.update(
                curWindowId,
                {
                  width: width,
                  height: height,
                },
                () => {
                  console.log(`Adjusted window size to: ${width} x ${height}`);
                },
              );
            }
          });
          const tabId = newWindow?.tabs?.[0]?.id; // 获取新窗口中第一个标签页的 ID
          curTabId = tabId;
          console.log('debug continue excute');
          setTimeout(() => {
            chrome.tabs.sendMessage(
              tabId!,
              {
                type: 'fortress:excute',
                data: { uidl: data, tabId },
              },
              {},
              (response) => {
                console.log(
                  'debug back fortress:excute response after create window',
                  response,
                );
              },
            );
          }, 3000);
        },
      );
    } else {
      await chrome.tabs.create(
        {
          url: pageUrl,
          active: true,
        },
        async (tab) => {
          curTabId = tab.id;
          console.log('debug continue excute');
          setTimeout(() => {
            chrome.tabs.sendMessage(
              tab.id as any,
              {
                type: 'fortress:excute',
                data: { uidl: data, tabId: tab.id },
              },
              {},
              (response) => {
                console.log(
                  'debug back fortress:excute response after create tab',
                  response,
                );
              },
            );
          }, 3000);
        },
      );
    }
  } else if (type === 'fortress:closeurl') {
    if (data.tabId) {
      chrome.tabs.remove(data.tabId);
    }
  } else if (type === 'fortress:closepreview') {
    console.log('debug fortress:closepreview', data);
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

let updateCookieName: string[] = [];

// 修改Cookie
function modifyCookies(
  url: string,
  modifications: { name: string; value: string; domain: string; path: '/' }[],
) {
  modifications.forEach((modification) => {
    // 删除旧的
    chrome.cookies.remove({ url, name: modification.name });
    chrome.cookies.set(
      {
        url,
        name: modification.name,
        value: modification.value,
        domain: modification.domain,
        path: modification.path,
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
    updateCookieName.push(modification.name);
  });
}
// 恢复Cookie
function restoreCookies(url: string, originalCookies: chrome.cookies.Cookie[]) {
  updateCookieName.forEach((name) => {
    const cookie = originalCookies.find((i) => i.name === name);
    if (!cookie) {
      return;
    }
    chrome.cookies.set(
      {
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
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
      console.log('debug fortress:connectcontent listener', type, data);
      if (type === 'fortress:updateurl') {
        const { tabId, pageUrl, delay } = res.data;
        console.log('debug fortress:updateurl curTabId', pageUrl, tabId);
        const curTab = await getCurrentTabInfo(tabId);
        console.log('debug curTab url compare', curTab?.url, pageUrl);
        const curTabPageUrl = curTab?.url;
        const continueExcuteFunc = () => {
          chrome.tabs.sendMessage(
            tabId as any,
            {
              type: 'fortress:excute',
              data: {
                uidl: data,
                tabId,
                excuteRecord: data?.excuteRecord,
              },
            },
            {},
            (response) => {
              console.log(
                'debug back fortress:excute response after update url',
                response,
              );
            },
          );
        };
        if (curTabPageUrl === pageUrl) {
          continueExcuteFunc();
          return;
        }
        chrome.tabs.update(
          curTabId,
          {
            url: pageUrl,
            active: true,
          },
          async (tab) => {
            if (tab?.id) {
              curTabId = tab?.id;
            }
            console.log('debug after update tab id', tab?.id, tab?.url);
            const delayTime = delay ? delay * 1000 : 3000;
            setTimeout(() => {
              continueExcuteFunc();
            }, delayTime);
          },
        );
      }
      if (type === 'fortress:excuteAINode') {
        sidepanelPort?.postMessage(res);
      }
      if (type === 'fortress:updatecookie') {
        const { tabId, cookieKey, cookieValue } = res.data;
        const curTab = await getCurrentTabInfo(tabId);
        const curTabPageUrl = curTab?.url;
        console.log('debug fortress:updateurl curTabId', curTabPageUrl, tabId);
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
            const isFullCookie = [
              'cookie',
              'Cookie',
              'cookies',
              'Cookies',
            ].includes(cookieKey);
            if (isFullCookie) {
              const cookiesKVs: { name: string; value: string }[] = cookieValue
                .replace(/\\ /g, '')
                .split(';')
                .filter(Boolean)
                .reduce((pre: { name: string; value: string }[], cur: string) => {
                  const key = cur.split('=')[0];
                  const value = cur.split('=')[1];
                  pre.push({ name: key.trim(), value: value.trim() });
                  return pre;
                }, []);
              // 修改Cookie
              modifyCookies(
                curTabPageUrl,
                cookiesKVs.map((i) => ({
                  ...i,
                  domain,
                  path: '/',
                })),
              );
            } else {
              // 修改Cookie
              modifyCookies(curTabPageUrl, [
                { name: cookieKey, value: cookieValue, domain, path: '/' },
              ]);
            }
          })
          .catch((error) => {
            console.error('Error saving cookies:', error);
          });
      }
      if (type === 'fortress:resetcookie') {
        const { tabId, pageUrl } = res.data;
        console.log('debug fortress:resetcookie curTabId', pageUrl, tabId);
        const curTab = await getCurrentTabInfo(tabId);
        const curTabPageUrl = curTab?.url;
        if (!curTabPageUrl) {
          return;
        }
        restoreCookies(curTabPageUrl, originalCookies);
      }
    });
  }
});
