import React, { useState, useId, useMemo } from 'react';
import {
  Receipt,
  XCircle,
  CreditCard,
  Banknote,
  UtensilsCrossed,
  Gamepad2,
  Tag,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

export interface OrderedReceiptItem {
  id?: string;
  name: string;
  quantity: number;
  unitPrice?: number;
  totalPrice: number;
  category?: string;
}

export type PaymentMethod = 'UPI' | 'CASH';

export interface SettleInvoicePayload {
  stationName: string;
  subTotal: number;
  discountAmount: number;
  discountPercent: number;
  grandTotal: number;
  paymentMethod: PaymentMethod;
  orderedItems: OrderedReceiptItem[];
}

export interface SettleInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSettle: (payload: SettleInvoicePayload) => Promise<void> | void;
  stationName: string;
  customerName?: string | null;
  customerPhone?: string | null;
  timeCharge: number;
  elapsedMinutes?: number;
  allocatedMinutes?: number;
  orderedItems?: OrderedReceiptItem[];
  ordersCharge?: number;
  isSubmitting?: boolean;
  errorMessage?: string | null;
}

export const SettleInvoiceModal: React.FC<SettleInvoiceModalProps> = ({
  isOpen,
  onClose,
  onSettle,
  stationName,
  customerName,
  customerPhone,
  timeCharge = 0,
  elapsedMinutes,
  allocatedMinutes,
  orderedItems = [],
  ordersCharge,
  isSubmitting = false,
  errorMessage = null,
}) => {
  const discountInputId = useId();

  // State
  const [discountInput, setDiscountInput] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [touchedDiscount, setTouchedDiscount] = useState<boolean>(false);

  // Derived Food & Beverage total from itemized list, fallback to ordersCharge prop if list is empty
  const computedOrdersTotal = useMemo(() => {
    if (orderedItems && orderedItems.length > 0) {
      return orderedItems.reduce((acc, item) => acc + (Number(item.totalPrice) || 0), 0);
    }
    return Number(ordersCharge || 0);
  }, [orderedItems, ordersCharge]);

  // Safe subtotal calculation
  const safeTimeCharge = Math.max(0, Number(timeCharge) || 0);
  const subTotal = safeTimeCharge + Math.max(0, computedOrdersTotal);

  // Parse discount amount
  const parsedDiscount = parseFloat(discountInput);
  const rawDiscountAmount = Number.isFinite(parsedDiscount) ? parsedDiscount : 0;

  // Validation
  const isNegative = rawDiscountAmount < 0;
  const exceedsSubtotal = rawDiscountAmount > subTotal;
  const isDiscountInvalid = isNegative || exceedsSubtotal;

  // Safe effective discount amount
  const effectiveDiscountAmount = isDiscountInvalid ? 0 : rawDiscountAmount;

  // Grand total calculation: dynamically updates in real time
  const grandTotal = Math.max(0, subTotal - effectiveDiscountAmount);

  // Equivalent percentage for display or backend compatibility
  const discountPercent = subTotal > 0 ? (effectiveDiscountAmount / subTotal) * 100 : 0;

  // Quick discount chip presets (capped at subtotal)
  const quickPresets = useMemo(() => {
    return [20, 50, 100].filter((val) => val <= subTotal);
  }, [subTotal]);

  if (!isOpen) return null;

  const handleDiscountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTouchedDiscount(true);
    const val = e.target.value;
    // Allow empty string or non-negative decimal/integer
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      setDiscountInput(val);
    }
  };

  const handleApplyPreset = (val: number) => {
    setTouchedDiscount(true);
    if (val === effectiveDiscountAmount) {
      setDiscountInput('');
    } else {
      setDiscountInput(val.toString());
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || isDiscountInvalid) return;

    await onSettle({
      stationName,
      subTotal: Number(subTotal.toFixed(2)),
      discountAmount: Number(effectiveDiscountAmount.toFixed(2)),
      discountPercent: Number(discountPercent.toFixed(2)),
      grandTotal: Number(grandTotal.toFixed(2)),
      paymentMethod,
      orderedItems,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settle-invoice-title"
    >
      <div className="bg-[#FFFFFF] border border-[#E2E8F0] max-w-lg w-full rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl relative animate-in slide-in-from-bottom-5 duration-200 max-h-[92vh] flex flex-col pb-safe">
        {/* Header */}
        <div className="flex justify-between items-center pb-3.5 mb-3.5 border-b border-[#E2E8F0] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center text-[#EA580C]">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h3
                id="settle-invoice-title"
                className="text-base sm:text-lg font-bold text-[#172554] font-display flex items-center gap-2"
              >
                <span>Settle Invoice</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#172554] font-semibold border border-[#BFDBFE]">
                  {stationName}
                </span>
              </h3>
              {(customerName || customerPhone) && (
                <p className="text-[11px] text-[#64748B] truncate max-w-[280px] flex items-center gap-1.5">
                  {customerName && (
                    <span>Customer: <span className="text-[#0F172A] font-medium">{customerName}</span></span>
                  )}
                  {customerPhone && (
                    <span className="font-mono-code text-[#64748B]">({customerPhone})</span>
                  )}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close modal"
            className="text-[#64748B] hover:text-[#0F172A] p-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="space-y-4 overflow-y-auto pr-1 text-xs flex-1">
          {/* Top Receipt Breakdown Card */}
          <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-[#E2E8F0] space-y-3 shadow-xs">
            <div className="flex items-center justify-between text-[#64748B] font-semibold border-b border-[#E2E8F0] pb-2">
              <span className="uppercase tracking-wider text-[10px] text-[#64748B]">
                Itemized Summary
              </span>
              <span className="text-[10px] text-[#64748B]">
                Currency (₹ INR)
              </span>
            </div>

            {/* 1. Console Play Time Breakdown */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[#0F172A]">
                <div className="flex items-center gap-2">
                  <Gamepad2 className="w-4 h-4 text-[#172554] shrink-0" />
                  <span className="font-medium text-[#0F172A]">Console Play Time</span>
                  {elapsedMinutes !== undefined && (
                    <span className="text-[10px] text-[#64748B] bg-[#E2E8F0] px-1.5 py-0.5 rounded font-mono-code">
                      {elapsedMinutes}m{allocatedMinutes ? ` / ${allocatedMinutes}m` : ''}
                    </span>
                  )}
                </div>
                <span className="font-bold text-[#172554] font-mono-code">
                  ₹{safeTimeCharge.toFixed(2)}
                </span>
              </div>
            </div>

            {/* 2. Itemized Food & Drink Receipts */}
            <div className="pt-2 border-t border-[#E2E8F0] space-y-2">
              <div className="flex items-center justify-between text-[11px] text-[#64748B]">
                <span className="flex items-center gap-1.5 font-medium">
                  <UtensilsCrossed className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
                  <span>Food &amp; Beverage Orders:</span>
                </span>
                {orderedItems.length > 0 && (
                  <span className="text-[10px] text-[#64748B]">
                    {orderedItems.length} item{orderedItems.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {orderedItems.length > 0 ? (
                <div className="space-y-1.5 pl-2 max-h-36 overflow-y-auto pr-1">
                  {orderedItems.map((item, idx) => (
                    <div
                      key={item.id || `${item.name}-${idx}`}
                      className="flex items-center justify-between py-1 px-2 rounded-lg bg-[#FFFFFF] border border-[#E2E8F0] text-[11px] shadow-xs"
                    >
                      <div className="flex items-center gap-2 truncate pr-2">
                        <span className="text-[#0F172A] font-medium truncate">
                          {item.name}
                        </span>
                        <span className="text-[#EA580C] text-[10px] shrink-0 font-bold bg-[#FFF7ED] px-1.5 py-0.2 rounded border border-[#FED7AA]">
                          x{item.quantity}
                        </span>
                      </div>
                      <span className="font-semibold text-[#0F172A] font-mono-code shrink-0">
                        ₹{(Number(item.totalPrice) || 0).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : computedOrdersTotal > 0 ? (
                /* Fallback if individual items are not expanded but orders charge is present */
                <div className="flex items-center justify-between py-1 px-2 rounded-lg bg-[#FFFFFF] border border-[#E2E8F0] text-[11px]">
                  <span className="text-[#0F172A]">Food &amp; Beverage Orders</span>
                  <span className="font-semibold text-[#0F172A] font-mono-code">
                    ₹{computedOrdersTotal.toFixed(2)}
                  </span>
                </div>
              ) : (
                <div className="text-[11px] text-[#94A3B8] italic pl-5 py-0.5">
                  No food or drink items ordered.
                </div>
              )}
            </div>

            {/* Subtotal line */}
            <div className="pt-2 border-t border-[#E2E8F0] flex justify-between text-[#64748B] text-xs">
              <span>Subtotal:</span>
              <span className="text-[#0F172A] font-semibold font-mono-code">
                ₹{subTotal.toFixed(2)}
              </span>
            </div>

            {/* Applied Flat Discount Deduction Line */}
            {effectiveDiscountAmount > 0 && !isDiscountInvalid && (
              <div className="flex justify-between items-center text-[#15803D] bg-[#DCFCE7] border border-[#BBF7D0] px-2.5 py-1.5 rounded-xl font-medium">
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <Tag className="w-3.5 h-3.5" />
                  <span>Discount Applied:</span>
                  <span className="text-[10px] font-mono-code">
                    ({discountPercent.toFixed(1)}% OFF)
                  </span>
                </span>
                <span className="font-bold text-sm font-mono-code">
                  - ₹{effectiveDiscountAmount.toFixed(2)}
                </span>
              </div>
            )}

            {/* Prominent Grand Total Due */}
            <div className="flex justify-between items-center pt-2.5 border-t border-[#E2E8F0] text-[#0F172A]">
              <div>
                <span className="text-xs uppercase tracking-wider text-[#172554] font-bold block">
                  Grand Total Due
                </span>
                <span className="text-[10px] text-[#64748B]">Includes all charges &amp; discounts</span>
              </div>
              <div className="text-right">
                <span className="font-mono-code text-xl sm:text-2xl font-black text-[#172554] tracking-tight">
                  ₹{grandTotal.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Flat Cash Discount Input Section */}
          <div className="p-3.5 bg-[#FFF7ED] rounded-2xl border border-[#FED7AA] space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor={discountInputId}
                className="font-semibold text-[#0F172A] flex items-center gap-1.5 text-xs"
              >
                <Tag className="w-3.5 h-3.5 text-[#EA580C]" />
                <span>Flat Cash Discount:</span>
              </label>
              {effectiveDiscountAmount > 0 && !isDiscountInvalid && (
                <button
                  type="button"
                  onClick={() => setDiscountInput('')}
                  className="text-[10px] text-[#EA580C] hover:text-[#C2410C] underline cursor-pointer"
                >
                  Clear discount
                </button>
              )}
            </div>

            {/* Rupee Input Group */}
            <div className="relative flex items-center">
              <span className="absolute left-3 font-mono-code font-bold text-[#64748B] select-none text-sm">
                ₹
              </span>
              <input
                id={discountInputId}
                type="text"
                inputMode="decimal"
                value={discountInput}
                onChange={handleDiscountChange}
                placeholder="0.00"
                className={`w-full pl-8 pr-20 py-2.5 rounded-xl bg-[#FFFFFF] border font-mono-code text-sm font-bold text-[#0F172A] placeholder-[#94A3B8] focus:outline-none transition-all ${
                  isDiscountInvalid && touchedDiscount
                    ? 'border-[#B91C1C] ring-2 ring-[#B91C1C]/20 text-[#B91C1C]'
                    : 'border-[#E2E8F0] focus:border-[#EA580C] focus:ring-2 focus:ring-[#EA580C]/20'
                }`}
              />
              <span className="absolute right-3 text-[11px] text-[#64748B] uppercase font-semibold">
                Flat Off
              </span>
            </div>

            {/* Quick Flat Rupee Shortcut Buttons */}
            {quickPresets.length > 0 && (
              <div className="flex items-center gap-1.5 pt-1">
                <span className="text-[10px] text-[#64748B] shrink-0">Quick:</span>
                <div className="flex flex-wrap gap-1">
                  {quickPresets.map((val) => {
                    const isActive = effectiveDiscountAmount === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => handleApplyPreset(val)}
                        className={`px-2 py-0.5 rounded-lg border text-[10px] font-mono-code font-bold transition-all cursor-pointer ${
                          isActive
                            ? 'bg-[#EA580C] border-[#EA580C] text-white shadow-xs'
                            : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] hover:border-[#CBD5E1]'
                        }`}
                      >
                        ₹{val}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Validation Feedback */}
            {isNegative && (
              <p className="text-[11px] text-[#B91C1C] flex items-center gap-1 pt-0.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Discount cannot be negative.</span>
              </p>
            )}
            {exceedsSubtotal && (
              <p className="text-[11px] text-[#B91C1C] flex items-center gap-1 pt-0.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Discount cannot exceed subtotal (₹{subTotal.toFixed(2)}).
                </span>
              </p>
            )}
          </div>

          {/* Payment Method Selector */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-[#0F172A] text-xs">
              Payment Method:
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setPaymentMethod('UPI')}
                className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-bold text-xs transition-all cursor-pointer ${
                  paymentMethod === 'UPI'
                    ? 'bg-[#FFF7ED] border-[#EA580C] text-[#EA580C] ring-2 ring-[#EA580C]/20 shadow-xs'
                    : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] hover:border-[#CBD5E1]'
                }`}
              >
                <CreditCard className="w-4 h-4 text-[#EA580C]" />
                <span>UPI / QR</span>
                {paymentMethod === 'UPI' && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#EA580C] ml-auto" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('CASH')}
                className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-bold text-xs transition-all cursor-pointer ${
                  paymentMethod === 'CASH'
                    ? 'bg-[#FFF7ED] border-[#EA580C] text-[#EA580C] ring-2 ring-[#EA580C]/20 shadow-xs'
                    : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] hover:border-[#CBD5E1]'
                }`}
              >
                <Banknote className="w-4 h-4 text-[#EA580C]" />
                <span>Cash</span>
                {paymentMethod === 'CASH' && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#EA580C] ml-auto" />
                )}
              </button>
            </div>
          </div>

          {/* Error Message if any */}
          {errorMessage && (
            <div className="p-2.5 rounded-xl bg-[#FEE2E2] border border-[#FECACA] text-[#B91C1C] text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-[#B91C1C] mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="pt-3.5 mt-3.5 border-t border-[#E2E8F0] flex gap-2.5 shrink-0">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl bg-[#F1F5F9] hover:bg-[#E2E8F0] border border-[#E2E8F0] text-[#64748B] font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSubmitting || isDiscountInvalid}
            onClick={handleSubmit}
            className="flex-1 py-3 px-4 rounded-xl bg-[#172554] hover:bg-[#1E3A8A] text-[#FFFFFF] font-bold uppercase tracking-wider text-xs transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5"
          >
            {isSubmitting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />
                <span>Processing...</span>
              </>
            ) : (
              <span>SETTLE INVOICE (₹{grandTotal.toFixed(2)})</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
