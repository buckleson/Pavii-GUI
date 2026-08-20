import { ipcBridge } from '@/common';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { useOptionalPreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { Browser, Command, Down, FolderOpen, Terminal } from '@icon-park/react';
import { Button, Dropdown, Tooltip } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * `browser` opens the in-app browser (a tab in the preview panel); the other three launch
 * external programs. The two kinds differ, so a divider separates them in the dropdown.
 *
 * `browser` opens the in-app browser (a tab in the preview panel); the other three
 * launch external programs. The dropdown separates the two groups with a divider.
 */
type ToolType = 'vscode' | 'terminal' | 'explorer' | 'browser';

/** Tools that launch external programs via shell IPC */
type ExternalToolType = Exclude<ToolType, 'browser'>;

interface ToolOption {
  key: ToolType;
  label: string;
  icon: React.ReactNode;
  available: boolean;
}

interface WorkspaceOpenButtonProps {
  workspacePath: string;
  /**
   * Authoritative flag from `conversation.extra.is_temporary_workspace`.
   * External shell tools are hidden for temp workspaces (there is no meaningful
   * project folder to open), but the in-app browser still applies — so the button
   * itself stays, showing only Browser.
   */
  isTemporary: boolean;
}

const STORAGE_KEY = 'workspace-open-preference';

const isExternalTool = (tool: ToolType): tool is ExternalToolType => tool !== 'browser';

/**
 * Workspace Open Button — opens the workspace with various tools.
 *
 * Covers VS Code / Terminal / File Explorer (external programs) plus the in-app
 * browser, and remembers the user's last choice so the main button repeats it.
 */
const WorkspaceOpenButton: React.FC<WorkspaceOpenButtonProps> = ({ workspacePath, isTemporary }) => {
  const { t } = useTranslation();
  /**
   * The preview context is optional: this component mainly launches external programs and the
   * browser is incidental. Without the context - a file tree rendered outside a PreviewProvider,
   * say - the browser item is hidden and everything else still works.
   *
   * The preview context is optional: this component mainly launches external
   * programs and the browser is an extra. When it is unavailable (e.g. the file tree
   * rendered without a PreviewProvider) the Browser entry is hidden and everything
   * else keeps working.
   */
  const previewContext = useOptionalPreviewContext();
  const openBrowserTab = previewContext?.openBrowserTab;
  const [vscodeInstalled, setVscodeInstalled] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [preferredTool, setPreferredTool] = useState<ToolType | null>(null);

  // Check if VS Code is installed and load preferred tool
  useEffect(() => {
    // Load preferred tool from storage — applies to temp workspaces too, since
    // Browser is available there.
    const saved = localStorage.getItem(STORAGE_KEY) as ToolType | null;
    if (saved) {
      setPreferredTool(saved);
    }

    if (isTemporary) return;

    const checkTools = async () => {
      try {
        const installed = await ipcBridge.shell.checkToolInstalled.invoke({ tool: 'vscode' });
        setVscodeInstalled(installed);
      } catch (error) {
        console.warn('[WorkspaceOpenButton] Failed to check VS Code:', error);
        setVscodeInstalled(false);
      }
    };

    void checkTools();
  }, [isTemporary]);

  const handleOpenWith = useCallback(
    async (tool: ToolType) => {
      try {
        if (isExternalTool(tool)) {
          await ipcBridge.shell.openFolderWith.invoke({ folder_path: workspacePath, tool });
        } else {
          openBrowserTab?.();
        }
        // Save preference
        localStorage.setItem(STORAGE_KEY, tool);
        setPreferredTool(tool);
      } catch (error) {
        console.error(`[WorkspaceOpenButton] Failed to open folder with ${tool}:`, error);
      }
      setDropdownOpen(false);
    },
    [workspacePath, openBrowserTab]
  );

  // Build dropdown options. Temp workspaces have no project folder, so the
  // external tools drop out and only Browser remains.
  const toolOptions: ToolOption[] = useMemo(
    () => [
      {
        key: 'vscode',
        label: t('conversation.workspace.openWith.vscode', { defaultValue: 'VS Code' }),
        icon: <Command size={16} />,
        available: !isTemporary && vscodeInstalled,
      },
      {
        key: 'terminal',
        label: t('conversation.workspace.openWith.terminal', { defaultValue: 'Terminal' }),
        icon: <Terminal size={16} />,
        available: !isTemporary,
      },
      {
        key: 'explorer',
        label: t('conversation.workspace.openWith.explorer', { defaultValue: 'File Explorer' }),
        icon: <FolderOpen size={16} />,
        available: !isTemporary,
      },
      {
        key: 'browser',
        label: t('conversation.workspace.openWith.browser', { defaultValue: 'Browser' }),
        icon: <Browser size={16} />,
        available: Boolean(openBrowserTab),
      },
    ],
    [t, isTemporary, vscodeInstalled, openBrowserTab]
  );

  // Filter only available tools
  const availableOptions = useMemo(() => toolOptions.filter((opt) => opt.available), [toolOptions]);

  // Determine current tool: preferred > first available > browser
  const currentTool: ToolType = useMemo(() => {
    if (preferredTool && availableOptions.some((opt) => opt.key === preferredTool)) {
      return preferredTool;
    }
    return availableOptions[0]?.key ?? 'browser';
  }, [preferredTool, availableOptions]);

  // Get current icon based on selected tool
  const currentIcon = useMemo(() => {
    switch (currentTool) {
      case 'vscode':
        return <Command size={16} />;
      case 'explorer':
        return <FolderOpen size={16} />;
      case 'browser':
        return <Browser size={16} />;
      case 'terminal':
      default:
        return <Terminal size={16} />;
    }
  }, [currentTool]);

  const tooltipContent =
    currentTool === 'browser'
      ? t('conversation.workspace.openWith.browser', { defaultValue: 'Browser' })
      : t('conversation.workspace.openWorkspace', { defaultValue: 'Open workspace folder' });

  // Don't render in WebUI/browser mode: shell tools would run on the server with
  // no visible feedback, and the in-app browser needs Electron's <webview>.
  if (!isElectronDesktop()) return null;

  // Render nothing when no item is available (a temp workspace with no preview context), rather than leaving a button that does nothing when clicked
  // Nothing available (temp workspace with no preview context): render nothing rather
  // than a button that does nothing when clicked.
  if (availableOptions.length === 0) return null;

  const dropdownList = (
    <div className='workspace-open-dropdown p-4px'>
      {availableOptions.map((option, index) => (
        <React.Fragment key={option.key}>
          {/* Divider: the in-app browser and launching external programs are two different kinds of action
              Divider: the in-app browser behaves differently from launching external programs */}
          {option.key === 'browser' && index > 0 && <div className='my-4px mx-8px h-1px bg-[var(--color-border-2)]' />}
          <div
            className={`workspace-open-dropdown-item flex items-center gap-8px px-12px py-8px cursor-pointer hover:bg-[var(--color-fill-2)] rounded-4px transition-colors ${
              currentTool === option.key ? 'bg-[var(--color-fill-2)]' : ''
            }`}
            onClick={() => handleOpenWith(option.key)}
          >
            <span className='flex items-center justify-center w-20px h-20px'>{option.icon}</span>
            <span className='text-14px'>{option.label}</span>
            {currentTool === option.key && <span className='ml-auto text-12px text-[var(--color-text-3)]'>✓</span>}
          </div>
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div className='workspace-open-button flex items-center'>
      <Tooltip content={tooltipContent} mini>
        <Button
          type='text'
          size='small'
          className='workspace-open-button__btn flex items-center gap-4px pl-8px pr-4px'
          onClick={() => handleOpenWith(currentTool)}
        >
          {currentIcon}
        </Button>
      </Tooltip>

      <Dropdown
        trigger='click'
        position='br'
        popupVisible={dropdownOpen}
        onVisibleChange={setDropdownOpen}
        droplist={dropdownList}
      >
        <Button
          type='text'
          size='small'
          className='workspace-open-button__dropdown-btn pl-2px pr-4px'
          style={{ marginLeft: '-4px' }}
        >
          <Down size={12} className={`transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`} />
        </Button>
      </Dropdown>
    </div>
  );
};

export default WorkspaceOpenButton;
