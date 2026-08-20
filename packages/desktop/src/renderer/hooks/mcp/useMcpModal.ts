import { useState, useCallback } from 'react';
import type { IMcpServer } from '@/common/config/storage';

/**
 * MCP modal state hook
 * Owns every modal's visibility and its associated data
 */
export const useMcpModal = () => {
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [editingMcpServer, setEditingMcpServer] = useState<IMcpServer | undefined>();
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<string | null>(null);
  const [mcpCollapseKey, setMcpCollapseKey] = useState<Record<string, boolean>>({});

  // Show the add-MCP-server modal
  const showAddMcpModal = useCallback(() => {
    setEditingMcpServer(undefined);
    setShowMcpModal(true);
  }, []);

  // Show the edit-MCP-server modal
  const showEditMcpModal = useCallback((server: IMcpServer) => {
    setEditingMcpServer(server);
    setShowMcpModal(true);
  }, []);

  // Hide the MCP server modal
  const hideMcpModal = useCallback(() => {
    setShowMcpModal(false);
    setEditingMcpServer(undefined);
  }, []);

  // Show the delete confirmation modal
  const showDeleteConfirm = useCallback((serverId: string) => {
    setServerToDelete(serverId);
    setDeleteConfirmVisible(true);
  }, []);

  // Hide the delete confirmation modal
  const hideDeleteConfirm = useCallback(() => {
    setDeleteConfirmVisible(false);
    setServerToDelete(null);
  }, []);

  // Toggle the server collapse state
  const toggleServerCollapse = useCallback((serverId: string) => {
    setMcpCollapseKey((prev) => ({ ...prev, [serverId]: !prev[serverId] }));
  }, []);

  return {
    // State
    showMcpModal,
    editingMcpServer,
    deleteConfirmVisible,
    serverToDelete,
    mcpCollapseKey,

    // Actions
    showAddMcpModal,
    showEditMcpModal,
    hideMcpModal,
    showDeleteConfirm,
    hideDeleteConfirm,
    toggleServerCollapse,
  };
};
