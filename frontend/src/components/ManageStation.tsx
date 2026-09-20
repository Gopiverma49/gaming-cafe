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

  // Action Error Banner
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 1. Create Station Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createTier, setCreateTier] = useState<StationTier>('CONSOLE');
  const [createRate, setCreateRate] = useState('180');
  const [createTiers, setCreateTiers] = useState<PricingTier[]>(DEFAULT_PRICING_TIERS);

  // 2. Edit Modal State (Station Name, Tier, Rate, and Dynamic Pricing Tiers)
  const [editingStation, setEditingStation] = useState<StationLive | null>(null);
  const [editName, setEditName] = useState('');
  const [editTier, setEditTier] = useState<StationTier>('CONSOLE');
  const [editRate, setEditRate] = useState('');
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
      const rateNum = parseFloat(createRate) || 180;
      return await createStation({
        name: createName.trim(),
        tier: createTier,
        hourly_rate: rateNum,
        default_hourly_rate: rateNum,
        pricing_tiers: createTiers,
      });
    },
    onSuccess: (newSt) => {
      queryClient.invalidateQueries({ queryKey: ['stations-live'] });
      setShowCreateModal(false);
      setCreateName('');
      setCreateRate('180');
      setCreateTiers(DEFAULT_PRICING_TIERS);
      setActionError(null);
      showFeedback(`Station "${newSt.name}" created successfully!`);
      addNotification('SYSTEM', '✅ Station Created', `Added ${newSt.name} to the fleet.`);
    },
    onError: (err: any) => setActionError(err.message || 'Failed to create station'),
  });

  // Mutation: Edit Station (Name, Tier, Rate, Pricing Tiers)
  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editingStation) return;
      const rateNum = parseFloat(editRate);
      return await updateStation(editingStation.id, {
        name: editName.trim(),
        tier: editTier,
        hourly_rate: isNaN(rateNum) ? undefined : rateNum,
        default_hourly_rate: isNaN(rateNum) ? undefined : rateNum,
        pricing_tiers: editTiers,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stations-live'] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stations-live'] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stations-live'] });
      setDeletingStation(null);
      setActionError(null);
      showFeedback('Station deleted from fleet.');
      addNotification('SYSTEM', '🗑️ Station Deleted', 'Station removed.');
    },
    onError: (err: any) => setActionError(err.message || 'Failed to delete station'),
  });

  const availableStations = stations.filter((s) => s.status === 'AVAILABLE');
  const occupiedStations = stations.filter((s) => s.status === 'OCCUPIED');

  return (
    <div className="space-y-6">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <SlidersHorizontal className="w-6 h-6 text-emerald-400" />
            <h2 className="text-xl sm:text-2xl font-bold font-display text-white tracking-wide">
              Manage Stations
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
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
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-blue-400 hover:text-blue-300 font-bold text-xs rounded-xl border border-blue-500/30 transition-all uppercase tracking-wider"
          >
            <ArrowRightLeft className="w-4 h-4" />
            <span>Transfer Session</span>
          </button>

          <button
            onClick={() => {
              setShowCreateModal(true);
              setActionError(null);
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition-all uppercase tracking-wider"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Create Station</span>
          </button>
        </div>
      </div>

      {/* Notifications / Error Banner */}
      {actionError && (
        <div className="p-3.5 rounded-xl bg-rose-950/90 border border-rose-600/80 text-rose-200 flex items-center justify-between text-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-white p-1">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-950/90 border border-emerald-600/80 text-emerald-200 flex items-center justify-between text-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-400 hover:text-white p-1">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. Stations Management Table */}
      {isLoading ? (
        <div className="flex items-center justify-center p-16 bg-slate-900/50 rounded-3xl border border-slate-800">
          <div className="w-8 h-8 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
        </div>
      ) : stations.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/50 rounded-3xl border border-dashed border-slate-800 space-y-3">
          <Monitor className="w-12 h-12 text-slate-600 mx-auto" />
          <p className="text-sm text-slate-400">No stations registered yet.</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition-all uppercase"
          >
            Create First Station
          </button>
        </div>
      ) : (
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
          <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
            <h3 className="text-sm font-bold font-display uppercase tracking-wider text-white">
              Configured Station Hardware & Rates
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-mono-code uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4 font-semibold">Station Name</th>
                  <th className="py-3 px-4 font-semibold">Pricing Tiers</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {stations.map((st) => (
                  <tr
                    key={st.id}
                    className="hover:bg-slate-800/30 transition-colors group"
                  >
                    {/* Station Name */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300 group-hover:text-emerald-400 transition-colors">
                          <Gamepad2 className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="font-bold text-white text-sm block">
                            {st.name}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono-code">
                            ID: {st.id.substring(0, 8)}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Pricing Tiers: Chips/Badges */}
                    <td className="py-3.5 px-4">
                      {st.pricing_tiers && st.pricing_tiers.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5 max-w-sm">
                          {st.pricing_tiers.map((pt, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center px-2 py-0.5 rounded-lg bg-emerald-950/60 border border-emerald-600/40 text-emerald-300 font-mono-code text-[11px] font-bold shadow-sm"
                            >
                              {pt.label || `${pt.duration_min}m`}: ₹{pt.price}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 font-mono-code text-[11px]">
                          1h: ₹{Number(st.hourly_rate).toFixed(0)}
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
                            setEditName(st.name);
                            setEditTier(st.tier as StationTier);
                            setEditRate(String(st.default_hourly_rate || st.hourly_rate));
                            const existingTiers = (st.pricing_tiers && st.pricing_tiers.length > 0)
                              ? st.pricing_tiers.map((t) => ({ ...t }))
                              : [
                                  { duration_min: 30, price: Math.round(Number(st.hourly_rate) * 0.6), label: '30 mins' },
                                  { duration_min: 60, price: Number(st.hourly_rate), label: '1 hr' },
                                  { duration_min: 120, price: Math.round(Number(st.hourly_rate) * 1.8), label: '2 hrs' },
                                ];
                            setEditTiers(existingTiers);
                          }}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-all"
                          title="Edit Station"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>

                        {/* Delete Station Button */}
                        <button
                          onClick={() => setDeletingStation(st)}
                          className="px-2.5 py-1 bg-rose-950/40 hover:bg-rose-900/70 border border-rose-800/40 text-rose-400 hover:text-rose-200 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-all"
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
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-slate-900 border border-emerald-500/40 max-w-lg w-full rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl relative animate-in slide-in-from-bottom-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base sm:text-lg font-bold text-white font-display">
                  Create New Gaming Station
                </h3>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white p-1"
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
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Station Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CAR simulator, PS5 Station 4..."
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Platform Tier
                </label>
                <select
                  value={createTier}
                  onChange={(e) => setCreateTier(e.target.value as StationTier)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="CONSOLE">CONSOLE (PS5 / Xbox Series X)</option>
                  <option value="PC_RIG">PC_RIG (High-end RTX 4090)</option>
                  <option value="VR">VR (PlayStation VR2 / Meta Quest 3)</option>
                  <option value="SIMULATOR">SIMULATOR (Racing / Cockpit Rig)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Default Hourly Rate (₹) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  step="any"
                  placeholder="e.g. 180, 350"
                  value={createRate}
                  onChange={(e) => setCreateRate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono-code"
                />
              </div>

              {/* Pricing Tiers Configurator */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs font-semibold text-slate-200">
                      Duration Pricing Slabs
                    </label>
                    <p className="text-[10px] text-slate-400">
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
                    className="px-2.5 py-1 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Tier</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {createTiers.map((tier, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 p-2 rounded-xl bg-slate-950 border border-slate-800"
                    >
                      <div className="w-24">
                        <span className="text-[10px] text-slate-400 block mb-0.5">Duration (min)</span>
                        <input
                          type="number"
                          min="5"
                          step="5"
                          value={tier.duration_min}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            const updated = [...createTiers];
                            const label = val >= 60 ? (val % 60 === 0 ? `${val / 60} hr${val > 60 ? 's' : ''}` : `${val} mins`) : `${val} mins`;
                            updated[idx] = { ...tier, duration_min: val, label };
                            setCreateTiers(updated);
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-mono-code focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      <div className="flex-1">
                        <span className="text-[10px] text-slate-400 block mb-0.5">Label</span>
                        <input
                          type="text"
                          value={tier.label}
                          onChange={(e) => {
                            const updated = [...createTiers];
                            updated[idx] = { ...tier, label: e.target.value };
                            setCreateTiers(updated);
                          }}
                          placeholder="e.g. 1 hr"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      <div className="w-24">
                        <span className="text-[10px] text-slate-400 block mb-0.5">Price (₹)</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={tier.price}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            const updated = [...createTiers];
                            updated[idx] = { ...tier, price: val };
                            setCreateTiers(updated);
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-emerald-400 font-mono-code font-bold focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setCreateTiers(createTiers.filter((_, i) => i !== idx));
                        }}
                        className="p-1.5 mt-3.5 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded-lg transition-colors"
                        title="Delete Slab"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || !createName.trim()}
                  className="flex-1 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-slate-900 border border-blue-500/40 max-w-lg w-full rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl relative animate-in slide-in-from-bottom-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-blue-400" />
                <h3 className="text-base sm:text-lg font-bold text-white font-display">
                  Edit Station & Pricing Slabs
                </h3>
              </div>
              <button
                onClick={() => setEditingStation(null)}
                className="text-slate-400 hover:text-white p-1"
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
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Station Name *
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Platform Tier
                </label>
                <select
                  value={editTier}
                  onChange={(e) => setEditTier(e.target.value as StationTier)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="CONSOLE">CONSOLE</option>
                  <option value="PC_RIG">PC_RIG</option>
                  <option value="VR">VR</option>
                  <option value="SIMULATOR">SIMULATOR</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Default Hourly Rate (₹) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  step="any"
                  value={editRate}
                  onChange={(e) => setEditRate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 font-mono-code"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Used as fallback rate when custom minutes outside slabs are booked.
                </p>
              </div>

              {/* Dynamic Pricing Tiers Editor */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs font-semibold text-slate-200">
                      Duration Pricing Slabs
                    </label>
                    <p className="text-[10px] text-slate-400">
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
                    className="px-2.5 py-1 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/40 text-blue-400 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Tier</span>
                  </button>
                </div>

                {editTiers.length === 0 ? (
                  <div className="p-3 rounded-xl bg-slate-950 border border-dashed border-slate-800 text-center text-xs text-slate-500">
                    No custom tiers added. Click "Add Tier" to create duration slabs.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {editTiers.map((tier, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 p-2 rounded-xl bg-slate-950 border border-slate-800"
                      >
                        <div className="w-24">
                          <span className="text-[10px] text-slate-400 block mb-0.5">Duration (min)</span>
                          <input
                            type="number"
                            min="5"
                            step="5"
                            value={tier.duration_min}
                            onChange={(e) => {
                              const val = parseInt(e.target.value) || 0;
                              const updated = [...editTiers];
                              const label = val >= 60 ? (val % 60 === 0 ? `${val / 60} hr${val > 60 ? 's' : ''}` : `${val} mins`) : `${val} mins`;
                              updated[idx] = { ...tier, duration_min: val, label };
                              setEditTiers(updated);
                            }}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-mono-code focus:outline-none focus:border-blue-500"
                          />
                        </div>

                        <div className="flex-1">
                          <span className="text-[10px] text-slate-400 block mb-0.5">Label</span>
                          <input
                            type="text"
                            value={tier.label}
                            onChange={(e) => {
                              const updated = [...editTiers];
                              updated[idx] = { ...tier, label: e.target.value };
                              setEditTiers(updated);
                            }}
                            placeholder="e.g. 1 hr"
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                          />
                        </div>

                        <div className="w-24">
                          <span className="text-[10px] text-slate-400 block mb-0.5">Price (₹)</span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={tier.price}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              const updated = [...editTiers];
                              updated[idx] = { ...tier, price: val };
                              setEditTiers(updated);
                            }}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-emerald-400 font-mono-code font-bold focus:outline-none focus:border-blue-500"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setEditTiers(editTiers.filter((_, i) => i !== idx));
                          }}
                          className="p-1.5 mt-3.5 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded-lg transition-colors"
                          title="Delete Slab"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingStation(null)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editMutation.isPending || !editName.trim()}
                  className="flex-1 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-400 hover:to-indigo-400 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                >
                  {editMutation.isPending ? 'Saving...' : 'Save Pricing Tiers'}
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
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-slate-900 border border-blue-500/40 max-w-md w-full rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl relative animate-in slide-in-from-bottom-5">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-blue-400" />
                <h3 className="text-base sm:text-lg font-bold text-white font-display">
                  Transfer Active Station Session
                </h3>
              </div>
              <button
                onClick={() => setTransferSource(null)}
                className="text-slate-400 hover:text-white p-1"
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
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  From (Active Station)
                </label>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                  <span className="font-bold text-white text-sm">{transferSource.name}</span>
                  <span className="text-[11px] text-amber-400 font-mono-code font-bold">
                    {transferSource.elapsed_minutes}m active
                  </span>
                </div>
              </div>

              {/* Destination Station */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  To (Available Destination Station) *
                </label>
                {availableStations.filter((s) => s.id !== transferSource.id).length === 0 ? (
                  <p className="text-xs text-rose-400 bg-rose-950/40 p-3 rounded-xl border border-rose-900/50">
                    No available stations free to receive transfer right now.
                  </p>
                ) : (
                  <select
                    required
                    value={targetStationId}
                    onChange={(e) => setTargetStationId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="">-- Select Destination Station --</option>
                    {availableStations
                      .filter((s) => s.id !== transferSource.id)
                      .map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.name} ({st.tier} - Rate: {Number(st.hourly_rate).toFixed(0)})
                        </option>
                      ))}
                  </select>
                )}
              </div>

              <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-900/60 text-[11px] text-blue-300">
                Transfers move the player, elapsed playing timer, and all pending kitchen orders seamlessly with zero downtime.
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setTransferSource(null)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transferMutation.isPending || !targetStationId}
                  className="flex-1 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-400 hover:to-indigo-400 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-500/40 max-w-sm w-full rounded-2xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center gap-2 text-rose-400 font-bold text-base">
              <Trash2 className="w-5 h-5" />
              <span>Delete Station?</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to permanently remove{' '}
              <strong className="text-white">"{deletingStation.name}"</strong> from your fleet?
              This action cannot be undone.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeletingStation(null)}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50"
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
