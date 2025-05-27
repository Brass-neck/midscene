// @ts-nocheck
import {
  BorderOutlined,
  HistoryOutlined,
  LoadingOutlined,
  SendOutlined,
  SettingOutlined,
  PoweroffOutlined,
  ForwardOutlined,
} from '@ant-design/icons';
import type { GroupedActionDump, UIContext } from '@midscene/core';
import { Helmet } from '@modern-js/runtime/head';
import {
  Alert,
  Button,
  Checkbox,
  // Select,
  Spin,
  Tooltip,
  message,
  Form,
  Input,
  Dropdown,
  Space,
  Badge,
  Collapse,
} from 'antd';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import Blackboard from './blackboard';
import { iconForStatus } from './misc';
import { Player } from './player';
import DemoData from './playground-demo-ui-context.json';
import type { ReplayScriptsInfo } from './replay-scripts';
import { allScriptsFromDump } from './replay-scripts';
import './playground-component.less';
import { Logo } from './logo';

// import { serverBase, useServerValid } from './open-in-playground';
import { useServerValid } from './playground/useServerValid';
const serverBase = 'http://localhost:5800';

import { overrideAIConfig } from '@midscene/shared/env';
import {
  ERROR_CODE_NOT_IMPLEMENTED_AS_DESIGNED,
  StaticPage,
  StaticPageAgent,
} from '@midscene/web/playground';
import type { WebUIContext } from '@midscene/web/utils';
import type { MenuProps } from 'antd';
import { EnvConfig } from './env-config';
import { useEnvConfig } from './store/store';
import { type HistoryItem, useHistoryStore } from './store/history';

import {
  ChromeExtensionProxyPage,
  ChromeExtensionProxyPageAgent,
} from '@midscene/web/chrome-extension';
import { buildYaml } from '@midscene/web/yaml';

import yaml from 'js-yaml';
// import ButtonGroup from 'antd/es/button/button-group';

interface PlaygroundResult {
  result: any;
  dump: GroupedActionDump | null;
  reportHTML: string | null;
  error: string | null;
}

const requestPlaygroundServer = async (
  context: UIContext,
  type: string,
  prompt: string,
) => {
  const res = await fetch(`${serverBase}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ context, type, prompt }),
  });
  return res.json();
};

const actionNameForType = (type: string) => {
  if (type === 'aiAction') {
    return 'Action';
  }
  if (type === 'aiQuery') {
    return 'Query';
  }
  if (type === 'aiAssert') {
    return 'Assert';
  }
  return type;
};

// const { TextArea } = Input;

export const staticAgentFromContext = (context: WebUIContext) => {
  const page = new StaticPage(context);
  return new StaticPageAgent(page);
};

export const useStaticPageAgent = (
  context: WebUIContext | undefined | null,
): StaticPageAgent | null => {
  const agent = useMemo(() => {
    if (!context) {
      return null;
    }

    return staticAgentFromContext(context);
  }, [context]);
  return agent;
};

const useHistorySelector = (onSelect: (history: HistoryItem) => void) => {
  const history = useEnvConfig((state) => state.history);
  const clearHistory = useEnvConfig((state) => state.clearHistory);

  const items: MenuProps['items'] = history.map((item, index) => ({
    label: (
      <a onClick={() => onSelect(item)}>
        {actionNameForType(item.type)} - {item.prompt.slice(0, 50)}
        {item.prompt.length > 50 ? '...' : ''}
      </a>
    ),
    key: String(index),
  }));

  items.push({
    type: 'divider',
  });

  items.push({
    label: (
      <a onClick={() => clearHistory()}>
        <Space>Clear History</Space>
      </a>
    ),
    key: 'clear',
  });

  return history.length > 0 ? (
    <div className="history-selector">
      <Dropdown menu={{ items }}>
        <Space>
          <HistoryOutlined />
          history
        </Space>
      </Dropdown>
    </div>
  ) : null;
};

const errorMessageServerNotReady = (
  <span>
    Don't worry, just one more step to launch the playground server.
    <br />
    Please run one of the commands under the midscene project directory:
    <br />
    a. <strong>npx midscene-playground</strong>
    <br />
    b. <strong>npx --yes @midscene/web</strong>
  </span>
);

const serverLaunchTip = (
  <div className="server-tip">
    <Alert
      message="Playground Server Not Ready"
      description={errorMessageServerNotReady}
      type="warning"
    />
  </div>
);

// remember to destroy the agent when the tab is destroyed: agent.page.destroy()
export const extensionAgentForTab = (
  forceSameTabNavigation = true,
  tabId?: number,
) => {
  const page = new ChromeExtensionProxyPage(forceSameTabNavigation, tabId);
  return new ChromeExtensionProxyPageAgent(page);
};

const blankResult: PlaygroundResult = {
  result: null,
  dump: null,
  reportHTML: null,
  error: null,
};

export function Playground({
  getAgent,
  hideLogo,
  showContextPreview = true,
  dryMode = false,
  yamlMode = false,
}: {
  getAgent: (
    forceSameTabNavigation?: boolean,
    tabId?: number,
  ) => StaticPageAgent | ChromeExtensionProxyPageAgent | null;
  hideLogo?: boolean;
  showContextPreview?: boolean;
  dryMode?: boolean;
  yamlMode?: boolean;
}) {
  const [uiContextPreview, setUiContextPreview] = useState<
    UIContext | undefined
  >(undefined);

  const [loading, setLoading] = useState(false);
  const [curStepDesc, setCurStepDesc] = useState('');
  let curStepDescVar = '';
  const [loadingProgressText, setLoadingProgressText] = useState('');
  const [stepCount, setStepCount] = useState(5);
  const [curStep, setCurStep] = useState(0);
  const [result, setResult] = useState<(PlaygroundResult | null)[]>([]);
  const [verticalMode, setVerticalMode] = useState(false);
  // const { tabUrl } = useChromeTabInfo();
  const [form] = Form.useForm();
  const {
    config,
    serviceMode,
    setServiceMode,
    loadConfig,
    getConfigStringFromLocalStorage,
  } = useEnvConfig();
  const forceSameTabNavigation = useEnvConfig(
    (state) => state.forceSameTabNavigation,
  );
  const setForceSameTabNavigation = useEnvConfig(
    (state) => state.setForceSameTabNavigation,
  );
  const configAlreadySet = Object.keys(config || {}).length >= 1;
  const runResultRef = useRef<HTMLHeadingElement>(null);
  // const addHistory = useEnvConfig((state) => state.addHistory);
  const addHistory = useHistoryStore((state) => state.addHistory);

  // AI Node Num
  let AINodeNum = 0;

  // 封装 port 监听
  let sidePanelPort;
  const portListener = () => {
    sidePanelPort = chrome.runtime.connect('jflcdlaondhiefginpknleiabkhblnlf', {
      name: 'fortress:sidepanel',
    });
    sidePanelPort.onMessage.addListener(async (message) => {
      const { type, data } = message;
      console.log('CANARY【playground】port listen', message);

      if (type === 'fortress:excuteAINode') {
        try {
          const { tabId } = data;
          await handleRunYaml(data.node.data.formData.ai, tabId);
          --AINodeNum;
          sidePanelPort.postMessage({
            type: 'fortress:excuteAINode',
            data: { AINodeNum },
          });
        } catch (error) {
          console.error('sidePanel port fortress:excuteAINode error:', error);
          sidePanelPort.postMessage({
            message: 'sidePanel port fortress:excuteAINode error',
          });
        }
      }
    });
  };
  // if the screen is narrow, we use vertical mode
  useEffect(() => {
    const sizeThreshold = 750;
    setVerticalMode(window.innerWidth < sizeThreshold);

    const handleResize = () => {
      setVerticalMode(window.innerWidth < sizeThreshold);
    };
    window.addEventListener('resize', handleResize);

    chrome.runtime.onMessage.addListener(
      async (message, sender, sendResponse) => {
        const { type, data } = message;
        if (type === 'fortress:excuteNode') {
          const curNode = data.node?.data?.name || data.node.name || '';
          curStepDescVar = curNode;
          setCurStepDesc(curNode);
        } else if (type === 'fortress:closepreview') {
          setCurStepDesc('');
        } else if (type === 'fortress:initPage') {
          window.location.reload();
        } else if (type === 'fortress:initConfig') {
          const aiNode = data?.nodes?.find(
            (node: any) => node?.type === 'AINode',
          );
          aiNode &&
            loadConfig(
              aiNode.data.formData.modelConfig.configStr ||
                getConfigStringFromLocalStorage() ||
                '',
            );
          setResult([]);
          setReplayScriptsInfo(null);
          setBigNodeInfo({});
          setBigResult({});
        } else if (type === 'fortress:calcAINode') {
          AINodeNum = data;
        }
        return true;
      },
    );

    portListener();
    const portCheckTimer = setInterval(() => {
      console.log('查看port是否存在', sidePanelPort);
      if (sidePanelPort) {
        return;
      }
      portListener();
    }, 3000);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearInterval(portCheckTimer);
    };
  }, []);

  // override AI config
  useEffect(() => {
    overrideAIConfig(config as any);
  }, [config]);

  // 多个报告
  const [bigNodeInfo, setBigNodeInfo] = useState({});
  const [bigResult, setBigResult] = useState({});
  const [replayScriptsInfo, setReplayScriptsInfo] =
    useState<ReplayScriptsInfo | null>(null);

  const [replayCounter, setReplayCounter] = useState(0);
  const serverValid = useServerValid(serviceMode === 'Server');

  const resetResult = (stepIndex: number) => {
    setResult((prev) => {
      const newResult = [...prev];
      newResult[stepIndex] = null;
      return newResult;
    });
    setLoading(false);
    setReplayScriptsInfo(null);
  };

  // setup context preview
  useEffect(() => {
    if (uiContextPreview) {
      return;
    }
    if (!showContextPreview) {
      return;
    }

    getAgent(forceSameTabNavigation)
      ?.getUIContext()
      .then((context: UIContext) => {
        setUiContextPreview(context);
      })
      .catch((e) => {
        message.error('Failed to get UI context');
        console.error(e);
      });
  }, [uiContextPreview, showContextPreview, getAgent]);

  const trackingTip = 'limit popup to current tab';
  const configItems = [
    {
      label: (
        <Checkbox
          onChange={(e) => setForceSameTabNavigation(e.target.checked)}
          checked={forceSameTabNavigation}
        >
          {trackingTip}
        </Checkbox>
      ),
      key: 'config',
    },
  ];

  const configSelector =
    serviceMode === 'In-Browser-Extension' ? (
      <div className="config-selector">
        <Dropdown menu={{ items: configItems }}>
          <Space>
            <SettingOutlined />
            {forceSameTabNavigation ? trackingTip : "don't track popup"}
          </Space>
        </Dropdown>
      </div>
    ) : null;

  const currentAgentRef = useRef<
    StaticPageAgent | ChromeExtensionProxyPageAgent | null
  >(null);

  const currentRunningIdRef = useRef<number | null>(0);
  const interruptedFlagRef = useRef<Record<number, boolean>>({});
  const handleRun = async (
    stepIndex: number,
    isYamlMode = false,
    yamlFlowItem?: any,
  ) => {
    const _value = form.getFieldsValue();
    if (isYamlMode) {
      let type = '';
      if (yamlFlowItem.ai) {
        type = 'ai';
      } else if (yamlFlowItem.aiQuery) {
        type = 'aiQuery';
      } else if (yamlFlowItem.aiAssert) {
        type = 'aiAssert';
      } else if (yamlFlowItem.sleep) {
        type = 'sleep';
      } else if (yamlFlowItem.aiScroll) {
        type = 'aiScroll';
      }
      _value[`type-${stepIndex}`] = type;
      _value[`prompt-${stepIndex}`] = yamlFlowItem[type] || '';
    }
    console.log('CANARY【playground】handleRun _value', _value);

    const value = {
      type: _value[`type-${stepIndex}`],
      prompt: _value[`prompt-${stepIndex}`],
    };

    if (!value.prompt) {
      return false;
    }

    const startTime = Date.now();

    setResult((prev) => {
      const newResult = [...prev];
      newResult[stepIndex] = null;
      return newResult;
    });
    addHistory({
      type: value.type,
      prompt: value.prompt,
      timestamp: Date.now(),
    });
    let result: PlaygroundResult = { ...blankResult };

    // currentAgentRef.current =
    //   currentAgentRef.current || getAgent(forceSameTabNavigation);

    const thisRunningId = Date.now();
    try {
      if (!currentAgentRef.current) {
        throw new Error('No agent found');
      }
      // currentAgentRef.current = activeAgent;

      currentRunningIdRef.current = thisRunningId;
      interruptedFlagRef.current[thisRunningId] = false;
      // currentAgentRef.current.resetDump();
      currentAgentRef.current.opts.onTaskStartTip = (tip: string) => {
        if (interruptedFlagRef.current[thisRunningId]) {
          return;
        }
        console.log('CANARY【playground】onTaskStartTip', tip);
        setLoadingProgressText(tip);
      };
      if (serviceMode === 'Server') {
        const uiContext = await currentAgentRef.current?.getUIContext();
        result = await requestPlaygroundServer(
          uiContext!,
          value.type,
          value.prompt,
        );
      } else {
        if (value.type === 'aiAction' || value.type === 'ai') {
          result.result = await currentAgentRef.current?.aiAction(value.prompt);
        } else if (value.type === 'aiQuery') {
          result.result = await currentAgentRef.current?.aiQuery(value.prompt);
        } else if (value.type === 'aiAssert') {
          result.result = await currentAgentRef.current?.aiAssert(
            value.prompt,
            undefined,
            {
              keepRawResponse: true,
            },
          );
        } else if (value.type === 'sleep') {
          await new Promise((resolve) => setTimeout(resolve, value.prompt));
          result.result = 'ok';
        } else if (value.type === 'aiYaml') {
          const res = await currentAgentRef.current?.runYaml(value.prompt);
          result.result = res.result;
        } else if (value.type === 'aiScroll') {
          const res = await currentAgentRef.current?.aiScroll(value.prompt);
          result.result = res.result;
        }
      }
    } catch (e: any) {
      const errorMessage = e?.message || '';
      console.error(e);
      if (errorMessage.includes('of different extension')) {
        result.error =
          'Conflicting extension detected. Please disable the suspicious plugins and refresh the page. Guide: https://midscenejs.com/quick-experience.html#faq';
      } else if (
        !errorMessage?.includes(ERROR_CODE_NOT_IMPLEMENTED_AS_DESIGNED)
      ) {
        result.error = errorMessage;
      } else {
        result.error = 'Unknown error';
      }
    }
    if (interruptedFlagRef.current[thisRunningId]) {
      console.log('interrupted, result is', result);
      return false;
    }

    try {
      if (
        serviceMode === 'In-Browser' ||
        serviceMode === 'In-Browser-Extension'
      ) {
        result.dump = currentAgentRef.current?.dumpDataString()
          ? JSON.parse(currentAgentRef.current.dumpDataString())
          : null;

        result.reportHTML = currentAgentRef.current?.reportHTMLString() || null;
      }
    } catch (e) {
      console.error(e);
    }

    setResult((prev) => {
      const newResult = [...prev];
      newResult[stepIndex] = result;
      return newResult;
    });

    setBigResult((prev) => {
      const newResult = { ...prev, [curStepDescVar]: result };
      return newResult;
    });

    console.log('CANARY【playground】handleRun result', result);
    if (
      (value.type === 'ai' ||
        value.type === 'aiAction' ||
        value.type === 'aiYaml') &&
      result?.dump
    ) {
      const info = allScriptsFromDump(result.dump);
      setReplayScriptsInfo(info);
      setReplayCounter((c) => c + 1);

      if (curStepDescVar) {
        setBigNodeInfo((prevBigNodeInfo) => {
          const originInfoScripts =
            prevBigNodeInfo[curStepDescVar]?.scripts || [];
          return {
            ...prevBigNodeInfo,
            [curStepDescVar]: {
              ...info,
              scripts: [...originInfoScripts, ...(info?.scripts || [])],
            },
          };
        });
      }
    } else {
      setReplayScriptsInfo(null);
    }
    console.log(`time taken: ${Date.now() - startTime}ms`);
  };

  const handleRunYaml = async (yamlString: string, tabId: number) => {
    setLoading(true);
    const obj = yaml.load(yamlString);
    console.log('CANARY【handleRunYaml】obj: ', obj);
    currentAgentRef.current =
      currentAgentRef.current || getAgent(forceSameTabNavigation, tabId);
    if (obj.tasks) {
      const { tasks } = obj;
      for (let j = 0; j < tasks.length; j++) {
        const task = tasks[j];
        const { name } = task;
        const flows = task.flow;

        for (let i = 0; i < flows.length; i++) {
          const flowItem = flows[i];
          const pass = await handleRun(j, true, flowItem);
          if (pass === false) {
            // not pass, return to prev step
            setCurStep((prev) => prev - 1);
          } else {
            // active next step
            setCurStep(j + 1);
          }
        }
      }
    }

    try {
      console.log('destroy agent.page', currentAgentRef.current?.page);
      await currentAgentRef.current?.page?.destroy();
      console.log('destroy agent.page done', currentAgentRef.current?.page);
    } catch (e) {
      console.error(e);
    }
    currentAgentRef.current = null;

    // await handleRun(0, true, yamlString);
    setLoading(false);
  };

  const handleRunFromStep = async (stepIndex: number) => {
    setLoading(true);
    for (let i = stepIndex; i < stepCount - 1; i++) {
      const pass = await handleRun(i);
      if (pass === false) {
        // not pass, return to prev step
        setCurStep((prev) => prev - 1);
      } else {
        // active next step
        setCurStep(i + 1);
      }
    }
    setLoading(false);
  };

  const runButtonEnabled =
    (serviceMode === 'In-Browser' && !!getAgent && configAlreadySet) ||
    (serviceMode === 'Server' && serverValid) ||
    (serviceMode === 'In-Browser-Extension' && !!getAgent && configAlreadySet);

  let resultDataToShow: any = (
    <div className="result-empty-tip">
      <span>The result will be shown here</span>
    </div>
  );
  const curResult = result[curStep];
  if (!serverValid && serviceMode === 'Server') {
    resultDataToShow = serverLaunchTip;
  } else if (loading) {
    resultDataToShow = (
      <div className="loading-container">
        <Spin spinning={loading} indicator={<LoadingOutlined spin />} />
        {/* <div className="loading-progress-text loading-progress-text-tab-info">
          {tabInfoString}
        </div> */}
        <div className="loading-progress-text loading-progress-text-progress">
          {loadingProgressText}
        </div>
      </div>
    );
  } else if (replayScriptsInfo) {
    resultDataToShow = (
      <Player
        key={`${curStep}-${replayCounter}`}
        replayScripts={replayScriptsInfo.scripts}
        imageWidth={replayScriptsInfo.width}
        imageHeight={replayScriptsInfo.height}
        reportFileContent={
          serviceMode === 'In-Browser-Extension' && bigResult?.reportHTML
            ? bigResult?.reportHTML
            : null
        }
      />
    );
  } else if (curResult?.result) {
    resultDataToShow =
      typeof curResult?.result === 'string' ? (
        <pre>{curResult?.result}</pre>
      ) : (
        <pre>{JSON.stringify(curResult?.result, null, 2)}</pre>
      );
  } else if (curResult?.error) {
    resultDataToShow = <pre>{curResult?.error}</pre>;
  }

  const serverTip = !serverValid ? (
    <div className="server-tip">
      {iconForStatus('failed')} Connection failed
    </div>
  ) : (
    <div className="server-tip">{iconForStatus('connected')} Connected</div>
  );

  const switchBtn =
    serviceMode === 'In-Browser-Extension' ? null : (
      <Tooltip
        title={
          <span>
            Server Mode: send the request through the server <br />
            In-Browser Mode: send the request through the browser fetch API (The
            AI service should support CORS in this case)
          </span>
        }
      >
        <Button
          type="link"
          onClick={(e) => {
            e.preventDefault();
            setServiceMode(serviceMode === 'Server' ? 'In-Browser' : 'Server');
          }}
        >
          {serviceMode === 'Server'
            ? 'Switch to In-Browser Mode'
            : 'Switch to Server Mode'}
        </Button>
      </Tooltip>
    );

  const statusContent = serviceMode === 'Server' ? serverTip : <EnvConfig />;

  const stoppable =
    !dryMode && serviceMode === 'In-Browser-Extension' && loading;

  const handleStop = async () => {
    window.location.reload();
  };

  const handleSkipNextStep = async (stepIndex?: number) => {
    const thisRunningId = currentRunningIdRef.current;
    if (thisRunningId) {
      interruptedFlagRef.current[thisRunningId] = true;
    }

    await currentAgentRef.current?.destroy();
    currentAgentRef.current = null;

    setResult([]);
    setReplayScriptsInfo(null);
    setBigNodeInfo({});
    setBigResult({});
  };

  let renderActionBtn: (stepIndex: number) => React.ReactNode = () => null;
  if (dryMode) {
    renderActionBtn = (stepIndex: number) => (
      <Tooltip title="Start executing until some interaction actions need to be performed. You can see the process of planning and locating.">
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={() => handleRunFromStep(stepIndex)}
          disabled={!runButtonEnabled}
          loading={loading}
        >
          Dry Run
        </Button>
      </Tooltip>
    );
  } else if (stoppable) {
    renderActionBtn = (stepIndex: number) => (
      <Button
        icon={<BorderOutlined />}
        onClick={() => handleSkipNextStep(stepIndex)}
      >
        Stop
      </Button>
    );
  } else {
    renderActionBtn = (stepIndex: number) => (
      <Button
        type="primary"
        icon={<SendOutlined />}
        onClick={() => handleRunFromStep(stepIndex)}
        disabled={!runButtonEnabled}
        loading={loading}
      >
        Run.
      </Button>
    );
  }

  // const historySelector = useHistorySelector((historyItem) => {
  //   form.setFieldsValue({
  //     [`prompt-${curStep}`]: historyItem.prompt,
  //     [`type-${curStep}`]: historyItem.type,
  //   });
  // });

  const logo = !hideLogo && (
    <div className="playground-header">
      <Logo />
    </div>
  );

  // const history = useEnvConfig((state) => state.history);
  const history = useHistoryStore((state) => state.history);
  const lastHistory = history[0];
  const historyInitialValues = useMemo(
    () => ({
      type: lastHistory?.type || 'aiAction',
      prompt: lastHistory?.prompt || '',
    }),
    [],
  );

  // async function copyCode(format: 'js' | 'yaml') {
  //   try {
  //     const stepContent = [];
  //     const fullValue = form.getFieldsValue();
  //     for (let i = 0; i < stepCount; i++) {
  //       const type = fullValue[`type-${i}`];
  //       const prompt = fullValue[`prompt-${i}`];
  //       if (!prompt) {
  //         continue;
  //       }
  //       if (format === 'yaml') {
  //         stepContent.push({ [type]: prompt });
  //       } else if (format === 'js') {
  //         stepContent.push(`await ${type}('${prompt}');`);
  //       }
  //     }
  //     if (stepContent.length) {
  //       let text = '';
  //       if (format === 'yaml') {
  //         text = buildYaml(
  //           {
  //             url: tabUrl || '',
  //           },
  //           [
  //             {
  //               name: 'aiAction',
  //               flow: stepContent as { [type: string]: string }[],
  //             },
  //           ],
  //         );
  //       } else if (format === 'js') {
  //         text = stepContent.join('\n');
  //       }
  //       await navigator.clipboard.writeText(text);
  //       message.success('Copy success');
  //     } else {
  //       message.info('No code to copy');
  //     }
  //   } catch (error) {
  //     message.success('Copy failed');
  //     console.error('Copy failed:', error);
  //   }
  // }

  // const [hoveringSettings, setHoveringSettings] = useState(false);
  const formSection = (
    <Form
      form={form}
      // onFinish={handleRun}
      initialValues={{ ...historyInitialValues }}
    >
      <div className="playground-form-container">
        <div className="form-part">
          {/* zz token配置 */}
          {/* <h3>
            {serviceMode === 'Server'
              ? 'Server Status'
              : 'In-Browser Request Config'}
          </h3> */}
          {/* {statusContent} */}
          <div className="switch-btn-wrapper">{switchBtn}</div>
          {/* zz token配置 */}
          {/* 堡垒步骤展示 */}
          <div>
            <Badge
              color={curStepDesc === '' ? '#F5212D' : '#52C41A'}
              text={
                curStepDesc === ''
                  ? '等待指令'
                  : `正在执行节点：${curStepDesc.toString()}`
              }
            />
            {curStepDesc === '' ? null : (
              <div>
                <Button
                  danger
                  size="small"
                  style={{
                    fontSize: '12px',
                    marginRight: '10px',
                    marginTop: '15px',
                  }}
                  type="primary"
                  icon={<PoweroffOutlined />}
                  onClick={() => handleStop()}
                >
                  停止
                </Button>
                {/* <Button
                  size="small"
                  style={{ fontSize: '12px' }}
                  type="primary"
                  icon={<ForwardOutlined />}
                  onClick={() => handleSkipNextStep()}
                >
                  下一步
                </Button> */}
              </div>
            )}
          </div>
          {/* 堡垒步骤展示 */}
        </div>
        <div
          className="form-part context-panel"
          style={{ display: showContextPreview ? 'block' : 'none' }}
        >
          <h3>UI Context</h3>
          {uiContextPreview ? (
            <>
              <Blackboard
                uiContext={uiContextPreview}
                hideController
                disableInteraction
              />
            </>
          ) : (
            <div>
              {iconForStatus('failed')} No UI context
              <Button
                type="link"
                onClick={(e) => {
                  e.preventDefault();
                  setUiContextPreview(DemoData as any);
                }}
              >
                Load Demo
              </Button>
              <div>
                To load the UI context, you can either use the demo data above,
                or click the 'Send to Playground' in the report page.
              </div>
            </div>
          )}
        </div>
        <div className="form-part input-wrapper">
          {/* zz 步骤step*/}
          {/* <h3>Run Steps</h3>
          {yamlMode ? (
            <>
              <Button icon={<BorderOutlined />} onClick={handleRunYaml}>
                run yaml
              </Button>
            </>
          ) : (
            new Array(stepCount).fill(1).map((_, i) => {
              return (
                <Input.Group
                  compact
                  className={
                    result[i]?.error ? 'fail' : curStep === i ? 'active' : ''
                  }
                  key={i.toString()}
                >
                  <Form.Item
                    name={`type-${i}`}
                    initialValue={'aiAction'}
                    noStyle
                  >
                    <Select>
                      <Select.Option value="aiAction">
                        {actionNameForType('aiAction')}
                      </Select.Option>
                      <Select.Option value="aiQuery">
                        {actionNameForType('aiQuery')}
                      </Select.Option>
                      <Select.Option value="aiAssert">
                        {actionNameForType('aiAssert')}
                      </Select.Option>
                    </Select>
                  </Form.Item>
                  <Form.Item name={`prompt-${i}`} noStyle>
                    <Input
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.metaKey) {
                          handleRunFromStep(i);
                          e.preventDefault();
                          e.stopPropagation();
                        }
                      }}
                      onFocus={() => {
                        if (!loading) {
                          setCurStep(i);
                          const dump = result[i]?.dump;
                          if (dump) {
                            const info = allScriptsFromDump(dump);
                            setReplayScriptsInfo(info);
                          } else {
                            setReplayScriptsInfo(null);
                          }
                        }
                      }}
                    />
                  </Form.Item>
                  {curStep === i ? renderActionBtn(i) : null}
                </Input.Group>
              );
            })
          )} */}
          {/* zz 步骤step*/}

          {/* zz 步骤操作 */}
          {/* <div className="form-controller-wrapper">
            <Tooltip title="aiAction report use a lot of memory, suggest step count less than 5">
              <Button
                type="primary"
                onClick={() => {
                  setStepCount(stepCount + 1);
                }}
              >
                + Step
              </Button>
            </Tooltip>
            <ButtonGroup>
              <Button onClick={() => copyCode('js')}>Copy as JS</Button>
              <Button onClick={() => copyCode('yaml')}>Copy as Yaml</Button>
            </ButtonGroup>
          </div>
          <div
            className={
              hoveringSettings
                ? 'settings-wrapper settings-wrapper-hover'
                : 'settings-wrapper'
            }
            onMouseEnter={() => setHoveringSettings(true)}
            onMouseLeave={() => setHoveringSettings(false)}
          >
            {historySelector}
            {configSelector}
          </div> */}
          {/* zz 步骤操作 */}
        </div>
      </div>
    </Form>
  );

  let resultWrapperClassName = 'result-wrapper';
  if (verticalMode) {
    resultWrapperClassName += ' vertical-mode-result';
  }
  if (replayScriptsInfo && verticalMode) {
    resultWrapperClassName += ' result-wrapper-compact';
  }

  const items = Object.keys(bigResult).map((key, index) => ({
    key: index,
    label: `节点：${key}`,
    children: (
      <Player
        key={`${curStep}-${replayCounter}`}
        replayScripts={bigNodeInfo[key]?.scripts}
        imageWidth={bigNodeInfo[key]?.width}
        imageHeight={bigNodeInfo[key]?.height}
        reportFileContent={
          serviceMode === 'In-Browser-Extension' && bigResult[key]?.reportHTML
            ? bigResult[key]?.reportHTML
            : null
        }
      />
    ),
  }));

  return verticalMode ? (
    <div className="playground-container vertical-mode">
      {formSection}
      <div className="form-part">
        {loading ? (
          <>
            <Badge color="#1677FF" text="AI 思考" />
            <div className={resultWrapperClassName}>{resultDataToShow}</div>
          </>
        ) : Object.keys(bigResult).length === 0 ? null : (
          <>
            <Badge
              color="#1677FF"
              text={
                <span>
                  AI 报告{' '}
                  <span style={{ color: '#969393dc' }}>
                    （仅展示 AI 节点报告）
                  </span>
                </span>
              }
            />
            <div style={{ marginTop: '20px' }}>
              <Collapse items={items} defaultActiveKey={[0]} />
            </div>
          </>
        )}
        <div ref={runResultRef} />
      </div>
    </div>
  ) : (
    <div className="playground-container">
      <Helmet>
        <title>Playground - Midscene.js</title>
      </Helmet>
      <PanelGroup autoSaveId="playground-layout" direction="horizontal">
        <Panel
          defaultSize={32}
          maxSize={60}
          minSize={20}
          className="playground-left-panel"
        >
          {logo}
          {formSection}
        </Panel>
        <PanelResizeHandle className="panel-resize-handle" />
        <Panel>
          <div className={resultWrapperClassName}>{resultDataToShow}</div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

export function StaticPlayground({
  context,
}: {
  context: WebUIContext | null;
}) {
  const agent = useStaticPageAgent(context);
  return <Playground getAgent={() => agent} dryMode={true} />;
}
