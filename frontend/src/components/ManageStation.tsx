import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  SlidersHorizontal,
  PlusCircle,
  Plus,
  Edit2,
  ArrowRightLeft,
  Trash2,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Monitor,
  Gamepad2,
} from 'lucide-react';
import { StationLive, StationTier, PricingTier } from '../types';
import {
  fetchLiveStations,
  createStation,
  updateStation,
  deleteStation,
  transferStation,
} from '../api';
import { useNotificationStore } from '../store/notificationStore';
import { POLL_INTERVALS, DEFAULT_PRICING_TIERS } from '../constants';

export const ManageStation: React.FC = () => {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore();

  // Active Query
  const { data: stations = [], isLoading } = useQuery<StationLive[]>({
    queryKey: ['stations-live'],
    queryFn: fetchLiveStations,
    refetchInterval: POLL_INTERVALS.STATIONS,
  });

  const safeStations = Array.isArray(stations) ? stations : [];

  // Action Error Banner
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 1. Create Station Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createTiers, setCreateTiers] = useState<PricingTier[]>(DEFAULT_PRICING_TIERS);

  // 2. Edit Modal State (Station Name and Dynamic Pricing Tiers)
  const [editingStation, setEditingStation] = useState<StationLive | null>(null);
  const [editName, setEditName] = useState('');
  const [editTiers, setEditTiers] = useState<PricingTier[]>([]);

  // 3. Transfer Station Modal State
  const [transferSource, setTransferSource] = useState<StationLive | null>(null);
  const [targetStationId, setTargetStationId] = useState('');

  // 4. Delete Station Confirmation State
  const [deletingStation, setDeletingStation] = useState<StationLive | null>(null);

  // Clear messages after timeout
  const showFeedback = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  // Mutation: Create Station
  const createMutation = useMutation({
    mutationFn: async () => {
      const hrTier = createTiers.find((t) => t.duration_min === 60);
      const rateNum = hrTier
        ? Number(hrTier.price)
        : createTiers.length > 0
        ? Number(createTiers[0].price) * (60 / createTiers[0].duration_min)
        : 180;
      const inferredTier: StationTier = createName.toLowerCase().includes('sim')
        ? 'SIMULATOR'
        : createName.toLowerCase().includes('vr')
        ? 'VR'
        : createName.toLowerCase().includes('pc')
        ? 'PC_RIG'
        : 'CONSOLE';

      return await createStation({
        name: createName.trim(),
        tier: inferredTier,
        hourly_rate: rateNum,
        default_hourly_rate: rateNum,
        pricing_tiers: createTiers,
      });
    },
    onSuccess: async (newSt) => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['stations-live'] }),
        queryClient.refetchQueries({ queryKey: ['fleet-categories'] }),
      ]);
      setShowCreateModal(false);
      setCreateName('');
      setCreateTiers(DEFAULT_PRICING_TIERS);
      setActionError(null);
      showFeedback(`Station "${newSt.name}" created successfully!`);
      addNotification('SYSTEM', '✅ Station Created', `Added ${newSt.name} to the fleet.`);
    },
    onError: (err: any) => setActionError(err.message || 'Failed to create station'),
  });

  // Mutation: Edit Station (Name, Rate & Pricing Tiers)
  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editingStation) return;
      const hrTier = editTiers.find((t) => t.duration_min === 60);
      const rateNum = hrTier
        ? Number(hrTier.price)
        : editTiers.length > 0
        ? Number(editTiers[0].price) * (60 / editTiers[0].duration_min)
        : Number(editingStation.hourly_rate || 180);

      return await updateStation(editingStation.id, {
        name: editName.trim(),
        hourly_rate: rateNum,
        default_hourly_rate: rateNum,
        pricing_tiers: editTiers,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['stations-live'] }),
        queryClient.refetchQueries({ queryKey: ['fleet-categories'] }),
      ]);
      setEditingStation(null);
      setActionError(null);
      showFeedback('Station details and pricing tiers updated successfully!');
      addNotification('SYSTEM', '✏️ Station Updated', 'Updated station configuration & tiered pricing.');
    },
    onError: (err: any) => setActionError(err.message || 'Failed to update station'),
  });

  // Mutation: Transfer Session
  const transferMutation = useMutation({
    mutationFn: async () => {
      if (!transferSource || !transferSource.active_session_id || !targetStationId) {
        throw new Error('Please select both a source active session and destination station.');
      }
      return await transferStation(transferSource.active_session_id, targetStationId);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['stations-live'] }),
        queryClient.refetchQueries({ queryKey: ['fleet-categories'] }),
      ]);
      setTransferSource(null);
      setTargetStationId('');
      setActionError(null);
      showFeedback('Player session transferred seamlessly!');
      addNotification('SYSTEM', '🔄 Session Transferred', 'Session moved to new station.');
    },
    onError: (err: any) => setActionError(err.message || 'Transfer failed'),
  });

  // Mutation: Delete Station
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deletingStation) return;
      return await deleteStation(deletingStation.id);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['stations-live'] }),
        queryClient.refetchQueries({ queryKey: ['fleet-categories'] }),
      ]);
      setDeletingStation(null);
      setActionError(null);
      showFeedback('Station deleted from fleet.');
      addNotification('SYSTEM', '🗑️ Station Deleted', 'Station removed.');
    },
    onError: (err: any) => setActionError(err.message || 'Failed to delete station'),
  });

  const availableStations = safeStations.filter((s) => s?.status === 'AVAILABLE');
  const occupiedStations = safeStations.filter((s) => s?.status === 'OCCUPIED');

  return (
    <div className="space-y-6">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E2E8F0]">
        <div>
          <div className="flex items-center gap-2.5">
            <SlidersHorizontal className="w-6 h-6 text-[#172554]" />
            <h2 className="text-xl sm:text-2xl font-bold font-display text-[#172554] tracking-wide">
              Manage Stations
            </h2>
          </div>
          <p className="text-xs text-[#64748B] mt-1 font-sans">
            Configure console fleet, rename stations, modify hourly pricing, and transfer active sessions.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => {
              if (occupiedStations.length === 0) {
                setActionError('No active occupied stations to transfer right now.');
                return;
              }
              setTransferSource(occupiedStations[0]);
              setTargetStationId('');
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#172554] font-bold text-xs rounded-xl border border-[#E2E8F0] shadow-xs transition-all uppercase tracking-wider cursor-pointer"
          >
            <ArrowRightLeft className="w-4 h-4 text-[#172554]" />
            <span>Transfer Session</span>
          </button>

          <button
            onClick={() => {
              setShowCreateModal(true);
              setActionError(null);
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#172554] hover:bg-[#1E3A8A] text-white font-bold text-xs rounded-xl shadow-sm transition-all uppercase tracking-wider cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Create Station</span>
          </button>
        </div>
      </div>

      {/* Notifications / Error Banner */}
      {actionError && (
        <div className="p-3.5 rounded-xl bg-[#FEE2E2] border border-[#FECACA] text-[#B91C1C] flex items-center justify-between text-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#B91C1C] shrink-0" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-[#B91C1C] hover:text-[#991B1B] p-1 cursor-pointer">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-3.5 rounded-xl bg-[#DCFCE7] border border-[#BBF7D0] text-[#15803D] flex items-center justify-between text-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#15803D] shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-[#15803D] hover:text-[#166534] p-1 cursor-pointer">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. Stations Management Table */}
      {isLoading ? (
        <div className="flex items-center justify-center p-16 bg-[#FFFFFF] rounded-3xl border border-[#E2E8F0]">
          <div className="w-8 h-8 rounded-full border-2 border-[#EA580C] border-t-transparent animate-spin" />
        </div>
      ) : stations.length === 0 ? (
        <div className="p-12 text-center bg-[#FFFFFF] rounded-3xl border border-dashed border-[#CBD5E1] space-y-3">
          <Monitor className="w-12 h-12 text-[#94A3B8] mx-auto" />
          <p className="text-sm text-[#64748B]">No stations registered yet.</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-[#172554] hover:bg-[#1E3A8A] text-white font-bold text-xs rounded-xl transition-all uppercase cursor-pointer"
          >
            Create First Station
          </button>
        </div>
      ) : (
        <div className="bg-[#FFFFFF] border border-[#E2E8F0] rounded-2xl sm:rounded-3xl overflow-hidden shadow-xs">
          <div className="px-5 py-4 border-b border-[#E2E8F0] bg-[#FFF7ED]/50 flex items-center justify-between">
            <h3 className="text-sm font-bold font-display uppercase tracking-wider text-[#172554]">
              Configured Station Hardware & Rates
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#FFF7ED] text-[#64748B] font-mono-code uppercase tracking-wider text-[11px] font-bold">
                  <th className="py-3.5 px-4 font-semibold">Station Name</th>
                  <th className="py-3.5 px-4 font-semibold">Pricing Tiers</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {safeStations.map((st) => (
                  <tr
                    key={st.id}
                    className="hover:bg-[#FFF7ED]/40 transition-colors group"
                  >
                    {/* Station Name */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center text-[#172554] group-hover:text-[#EA580C] transition-colors">
                          <Gamepad2 className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="font-bold text-[#0F172A] text-sm block">
                            {st?.name || 'Station'}
                          </span>
                          <span className="text-[10px] text-[#64748B] font-mono-code">
                            ID: {(st?.id || 'STN').substring(0, 8)}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Pricing Tiers: Chips/Badges */}
                    <td className="py-3.5 px-4">
                      {Array.isArray(st?.pricing_tiers) && st.pricing_tiers.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5 max-w-sm">
                          {st.pricing_tiers.map((pt, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center px-2 py-0.5 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] text-[#172554] font-mono-code text-[11px] font-bold"
                            >
                              {pt?.label || `${pt?.duration_min ?? 0}m`}: ₹{pt?.price ?? 0}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-[#F1F5F9] text-[#64748B] font-mono-code text-[11px]">
                          1h: ₹{Number(st?.hourly_rate || 0).toFixed(0)}
                        </span>
                      )}
                    </td>

                    {/* Action Buttons: Only Edit and Delete */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Edit Button */}
                        <button
                          onClick={() => {
                            setEditingStation(st);
                            setEditName(st?.name || '');
                            const existingTiers = (Array.isArray(st?.pricing_tiers) && st.pricing_tiers.length > 0)
                              ? st.pricing_tiers.map((t) => ({ ...t }))
                              : [
                                  { duration_min: 30, price: Math.round(Number(st?.hourly_rate || 180) * 0.6), label: '30 mins' },
                                  { duration_min: 60, price: Number(st?.hourly_rate || 180), label: '1 hr' },
                                  { duration_min: 120, price: Math.round(Number(st?.hourly_rate || 180) * 1.8), label: '2 hrs' },
                                ];
                            setEditTiers(existingTiers);
                          }}
                          className="px-2.5 py-1 bg-[#F8FAFC] hover:bg-[#F1F5F9] border border-[#E2E8F0] text-[#0F172A] rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
                          title="Edit Station"
                        >
                          <Edit2 className="w-3 h-3 text-[#172554]" />
                          <span>Edit</span>
                        </button>

                        {/* Delete Station Button */}
                        <button
                          onClick={() => setDeletingStation(st)}
                          className="px-2.5 py-1 bg-[#FEF2F2] hover:bg-[#FEE2E2] border border-[#FECACA] text-[#B91C1C] rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
                          title="Delete Station"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. MODAL: CREATE STATION */}
      {/* ========================================================================= */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-[#FFFFFF] border border-[#E2E8F0] max-w-lg w-full rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl relative animate-in slide-in-from-bottom-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-[#172554]" />
                <h3 className="text-base sm:text-lg font-bold text-[#172554] font-display">
                  Create New Gaming Station
                </h3>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-[#64748B] hover:text-[#0F172A] p-1 cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate();
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                  Station Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CAR simulator, PS5 Station 4..."
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="w-full bg-[#FFF7ED] border border-[#E2E8F0] rounded-xl px-3.5 py-2.5 text-sm text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#EA580C]"
                />
              </div>

              {/* Pricing Tiers Configurator */}
              <div className="space-y-2 pt-2 border-t border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A]">
                      Duration Pricing Slabs
                    </label>
                    <p className="text-[10px] text-[#64748B]">
                      Preset options presented to gamers during seat booking.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCreateTiers([
                        ...createTiers,
                        { duration_min: 30, price: 100, label: '30 mins' },
                      ]);
                    }}
                    className="px-2.5 py-1 bg-[#EFF6FF] hover:bg-[#DBEAFE] border border-[#BFDBFE] text-[#172554] rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Tier</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {createTiers.map((tier, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 p-2 rounded-xl bg-[#FFF7ED] border border-[#E2E8F0]"
                    >
                      <div className="w-24">
                        <span className="text-[10px] text-[#64748B] block mb-0.5 font-medium">Duration (min)</span>
                        <input
                          type="number"
                          value={tier.duration_min}
                          onChange={(e) => {
                            const updated = [...createTiers];
                            updated[idx].duration_min = Number(e.target.value);
                            setCreateTiers(updated);
                          }}
                          className="w-full bg-[#FFFFFF] border border-[#E2E8F0] rounded-lg px-2 py-1 text-xs text-[#0F172A] font-mono-code focus:outline-none focus:border-[#EA580C]"
                        />
                      </div>
                      <div className="w-24">
                        <span className="text-[10px] text-[#64748B] block mb-0.5 font-medium">Price (₹)</span>
                        <input
                          type="number"
                          value={tier.price}
                          onChange={(e) => {
                            const updated = [...createTiers];
                            updated[idx].price = Number(e.target.value);
                            setCreateTiers(updated);
                          }}
                          className="w-full bg-[#FFFFFF] border border-[#E2E8F0] rounded-lg px-2 py-1 text-xs text-[#0F172A] font-mono-code focus:outline-none focus:border-[#EA580C]"
                        />
                      </div>
                      <div className="flex-1">
                        <span className="text-[10px] text-[#64748B] block mb-0.5 font-medium">Display Label</span>
                        <input
                          type="text"
                          value={tier.label || ''}
                          onChange={(e) => {
                            const updated = [...createTiers];
                            updated[idx].label = e.target.value;
                            setCreateTiers(updated);
                          }}
                          className="w-full bg-[#FFFFFF] border border-[#E2E8F0] rounded-lg px-2 py-1 text-xs text-[#0F172A] focus:outline-none focus:border-[#EA580C]"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCreateTiers(createTiers.filter((_, i) => i !== idx));
                        }}
                        className="text-[#B91C1C] hover:text-[#991B1B] p-1 self-end mb-1 cursor-pointer"
                        title="Remove Tier"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-2.5 bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#64748B] rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || !createName.trim()}
                  className="flex-1 py-2.5 bg-[#172554] hover:bg-[#1E3A8A] text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create Station'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. MODAL: EDIT & IN-PLACE DYNAMIC PRICING TIERS EDITOR */}
      {/* ========================================================================= */}
      {editingStation && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-[#FFFFFF] border border-[#E2E8F0] max-w-lg w-full rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl relative animate-in slide-in-from-bottom-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-[#172554]" />
                <h3 className="text-base sm:text-lg font-bold text-[#172554] font-display">
                  Edit Station & Pricing Slabs
                </h3>
              </div>
              <button
                onClick={() => setEditingStation(null)}
                className="text-[#64748B] hover:text-[#0F172A] p-1 cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                editMutation.mutate();
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                  Station Name *
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-[#FFF7ED] border border-[#E2E8F0] rounded-xl px-3.5 py-2.5 text-sm text-[#0F172A] focus:outline-none focus:border-[#EA580C]"
                />
              </div>

              {/* Dynamic Pricing Tiers Editor */}
              <div className="space-y-2 pt-2 border-t border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A]">
                      Duration Pricing Slabs
                    </label>
                    <p className="text-[10px] text-[#64748B]">
                      Multi-tier price points shown on booking screen.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditTiers([
                        ...editTiers,
                        { duration_min: 30, price: 100, label: '30 mins' },
                      ]);
                    }}
                    className="px-2.5 py-1 bg-[#EFF6FF] hover:bg-[#DBEAFE] border border-[#BFDBFE] text-[#172554] rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Tier</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {editTiers.map((tier, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 p-2 rounded-xl bg-[#FFF7ED] border border-[#E2E8F0]"
                    >
                      <div className="w-24">
                        <span className="text-[10px] text-[#64748B] block mb-0.5 font-medium">Duration (min)</span>
                        <input
                          type="number"
                          value={tier.duration_min}
                          onChange={(e) => {
                            const updated = [...editTiers];
                            updated[idx].duration_min = Number(e.target.value);
                            setEditTiers(updated);
                          }}
                          className="w-full bg-[#FFFFFF] border border-[#E2E8F0] rounded-lg px-2 py-1 text-xs text-[#0F172A] font-mono-code focus:outline-none focus:border-[#EA580C]"
                        />
                      </div>
                      <div className="w-24">
                        <span className="text-[10px] text-[#64748B] block mb-0.5 font-medium">Price (₹)</span>
                        <input
                          type="number"
                          value={tier.price}
                          onChange={(e) => {
                            const updated = [...editTiers];
                            updated[idx].price = Number(e.target.value);
                            setEditTiers(updated);
                          }}
                          className="w-full bg-[#FFFFFF] border border-[#E2E8F0] rounded-lg px-2 py-1 text-xs text-[#0F172A] font-mono-code focus:outline-none focus:border-[#EA580C]"
                        />
                      </div>
                      <div className="flex-1">
                        <span className="text-[10px] text-[#64748B] block mb-0.5 font-medium">Display Label</span>
                        <input
                          type="text"
                          value={tier.label || ''}
                          onChange={(e) => {
                            const updated = [...editTiers];
                            updated[idx].label = e.target.value;
                            setEditTiers(updated);
                          }}
                          className="w-full bg-[#FFFFFF] border border-[#E2E8F0] rounded-lg px-2 py-1 text-xs text-[#0F172A] focus:outline-none focus:border-[#EA580C]"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditTiers(editTiers.filter((_, i) => i !== idx));
                        }}
                        className="text-[#B91C1C] hover:text-[#991B1B] p-1 self-end mb-1 cursor-pointer"
                        title="Remove Tier"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setEditingStation(null)}
                  className="flex-1 py-2.5 bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#64748B] rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editMutation.isPending || !editName.trim()}
                  className="flex-1 py-2.5 bg-[#172554] hover:bg-[#1E3A8A] text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {editMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. MODAL: TRANSFER STATION SESSION */}
      {/* ========================================================================= */}
      {transferSource && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-[#FFFFFF] border border-[#E2E8F0] max-w-md w-full rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl relative animate-in slide-in-from-bottom-5">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-[#172554]" />
                <h3 className="text-base sm:text-lg font-bold text-[#172554] font-display">
                  Transfer Active Station Session
                </h3>
              </div>
              <button
                onClick={() => setTransferSource(null)}
                className="text-[#64748B] hover:text-[#0F172A] p-1 cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                transferMutation.mutate();
              }}
              className="space-y-4"
            >
              {/* Source Station */}
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                  From (Active Station)
                </label>
                <div className="p-3 rounded-xl bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-between">
                  <span className="font-bold text-[#172554] text-sm">{transferSource.name}</span>
                  <span className="text-[11px] text-[#C2410C] font-mono-code font-bold">
                    {transferSource.elapsed_minutes}m active
                  </span>
                </div>
              </div>

              {/* Destination Station */}
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                  To (Available Destination Station) *
                </label>
                {availableStations.filter((s) => s?.id !== transferSource?.id).length === 0 ? (
                  <p className="text-xs text-[#B91C1C] bg-[#FEE2E2] p-3 rounded-xl border border-[#FECACA]">
                    No available stations free to receive transfer right now.
                  </p>
                ) : (
                  <select
                    required
                    value={targetStationId}
                    onChange={(e) => setTargetStationId(e.target.value)}
                    className="w-full bg-[#FFF7ED] border border-[#E2E8F0] rounded-xl px-3.5 py-2.5 text-sm text-[#0F172A] focus:outline-none focus:border-[#EA580C]"
                  >
                    <option value="">-- Select Destination Station --</option>
                    {availableStations
                      .filter((s) => s?.id !== transferSource?.id)
                      .map((st) => (
                        <option key={st.id} value={st.id}>
                          {st?.name || 'Station'} ({st?.tier || 'CONSOLE'} - Rate: ₹{Number(st?.hourly_rate || 0).toFixed(0)})
                        </option>
                      ))}
                  </select>
                )}
              </div>

              <div className="p-3 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] text-[11px] text-[#1E3A8A]">
                Transfers move the player, elapsed playing timer, and all pending kitchen orders seamlessly with zero downtime.
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setTransferSource(null)}
                  className="flex-1 py-2.5 bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#64748B] rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transferMutation.isPending || !targetStationId}
                  className="flex-1 py-2.5 bg-[#172554] hover:bg-[#1E3A8A] text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {transferMutation.isPending ? 'Transferring...' : 'Execute Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. MODAL: DELETE STATION CONFIRMATION */}
      {/* ========================================================================= */}
      {deletingStation && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] border border-[#FECACA] max-w-sm w-full rounded-2xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center gap-2 text-[#B91C1C] font-bold text-base">
              <Trash2 className="w-5 h-5" />
              <span>Delete Station?</span>
            </div>
            <p className="text-xs text-[#64748B] leading-relaxed">
              Are you sure you want to permanently remove{' '}
              <strong className="text-[#0F172A]">"{deletingStation.name}"</strong> from your fleet?
              This action cannot be undone.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeletingStation(null)}
                className="flex-1 py-2 bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#64748B] rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
                className="flex-1 py-2 bg-[#B91C1C] hover:bg-[#991B1B] text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-sm"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
