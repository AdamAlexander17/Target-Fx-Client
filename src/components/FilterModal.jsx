import React, { useState, useEffect } from 'react';

const FilterModal = ({ 
  isOpen, 
  onClose, 
  onApply,
  filters = {},
  onPendingChange
}) => {
  const [hasFloating, setHasFloating] = useState(filters.hasFloating || false);
  const [hasCredit, setHasCredit] = useState(filters.hasCredit || false);
  const [noDeposit, setNoDeposit] = useState(filters.noDeposit || false);
  const [hasPnl, setHasPnl] = useState(filters.hasPnl || false);

  // Sync state with filters prop when modal opens
  useEffect(() => {
    if (isOpen) {
      setHasFloating(filters.hasFloating || false);
      setHasCredit(filters.hasCredit || false);
      setNoDeposit(filters.noDeposit || false);
      setHasPnl(filters.hasPnl || false);
    }
  }, [isOpen, filters]);

  // Notify parent when there are pending changes
  useEffect(() => {
    if (isOpen && onPendingChange) {
      const hasPending = hasFloating !== (filters.hasFloating || false) || 
                        hasCredit !== (filters.hasCredit || false) || 
                        noDeposit !== (filters.noDeposit || false) ||
                        hasPnl !== (filters.hasPnl || false);
      const draft = { hasFloating, hasCredit, noDeposit, hasPnl }
      try {
        onPendingChange(hasPending, draft)
      } catch {
        // backward compatibility if consumer only expects boolean
        onPendingChange(hasPending)
      }
    }
  }, [isOpen, hasFloating, hasCredit, noDeposit, hasPnl, filters, onPendingChange]);

  if (!isOpen) return null;

  const handleApply = () => {
    onApply({
      hasFloating,
      hasCredit,
      noDeposit,
      hasPnl
    });
    onClose();
  };

  const handleReset = () => {
    setHasFloating(false);
    setHasCredit(false);
    setNoDeposit(false);
    setHasPnl(false);
    onApply({
      hasFloating: false,
      hasCredit: false,
      noDeposit: false,
      hasPnl: false
    });
    onClose();
  };

  return (
    <>
      {/* Backdrop overlay */}
      <div 
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          zIndex: 9998,
        }}
        onClick={onClose}
      />

      {/* Modal content */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          maxWidth: '412px',
          height: 'auto',
          background: '#FFFFFF',
          borderRadius: '28px 28px 0 0',
          boxShadow: '0 -8px 30px rgba(15, 23, 42, 0.12)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Top indicator line */}
        <div
          style={{
            width: '40px',
            height: '4px',
            background: '#CBD5E1',
            borderRadius: '2px',
            margin: '10px auto',
          }}
        />

        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 20px',
            marginBottom: '10px',
          }}
        >
          <button
            onClick={() => {
              if (typeof window !== 'undefined') {
                const ev = new CustomEvent('openCustomizeView')
                window.dispatchEvent(ev)
              }
              onClose()
            }}
            style={{
              background: 'transparent',
              border: '1px solid #D5DEEA',
              borderRadius: '12px',
              cursor: 'pointer',
              width: '36px',
              height: '36px',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="8"
              height="14"
              viewBox="0 0 8 14"
              fill="none"
              style={{ transform: 'rotate(180deg)' }}
            >
              <path
                d="M1 1L7 7L1 13"
                stroke="#4B4B4B"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <h2
            style={{
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 800,
              fontSize: '18px',
              lineHeight: '24px',
              color: '#0F172A',
              letterSpacing: '-0.02em',
              margin: 0,
            }}
          >
            Filter
          </h2>

          <div style={{ width: '36px' }} /> {/* Spacer for centering */}
        </div>

        {/* Divider line */}
        <div
          style={{
            width: '100%',
            height: '1px',
            background: '#D5DEEA',
            marginBottom: '20px',
          }}
        />

        {/* Filter options */}
        <div style={{ flex: 1, padding: '0 20px', marginBottom: '4px' }}>
          {/* Has Floating */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '13px 14px',
              border: '1px solid #D5DEEA',
              borderRadius: '14px',
              marginBottom: '10px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={hasFloating}
              onChange={(e) => setHasFloating(e.target.checked)}
              style={{
                width: '20px',
                height: '20px',
                accentColor: '#2563EB',
                cursor: 'pointer',
              }}
            />
            <span
              style={{
                fontFamily: 'Outfit, sans-serif',
                fontWeight: 500,
                fontSize: '15px',
                lineHeight: '20px',
                color: '#0F172A',
              }}
            >
              Has Floating
            </span>
          </label>

          {/* Has Credit */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '13px 14px',
              border: '1px solid #D5DEEA',
              borderRadius: '14px',
              marginBottom: '10px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={hasCredit}
              onChange={(e) => setHasCredit(e.target.checked)}
              style={{
                width: '20px',
                height: '20px',
                accentColor: '#2563EB',
                cursor: 'pointer',
              }}
            />
            <span
              style={{
                fontFamily: 'Outfit, sans-serif',
                fontWeight: 500,
                fontSize: '15px',
                lineHeight: '20px',
                color: '#0F172A',
              }}
            >
              Has Credit
            </span>
          </label>

          {/* No Deposit */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '13px 14px',
              border: '1px solid #D5DEEA',
              borderRadius: '14px',
              marginBottom: '10px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={noDeposit}
              onChange={(e) => setNoDeposit(e.target.checked)}
              style={{
                width: '20px',
                height: '20px',
                accentColor: '#2563EB',
                cursor: 'pointer',
              }}
            />
            <span
              style={{
                fontFamily: 'Outfit, sans-serif',
                fontWeight: 500,
                fontSize: '15px',
                lineHeight: '20px',
                color: '#0F172A',
              }}
            >
              No Deposit
            </span>
          </label>

          {/* Has P&L */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '13px 14px',
              border: '1px solid #D5DEEA',
              borderRadius: '14px',
              marginBottom: '10px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={hasPnl}
              onChange={(e) => setHasPnl(e.target.checked)}
              style={{
                width: '20px',
                height: '20px',
                accentColor: '#2563EB',
                cursor: 'pointer',
              }}
            />
            <span
              style={{
                fontFamily: 'Outfit, sans-serif',
                fontWeight: 500,
                fontSize: '15px',
                lineHeight: '20px',
                color: '#0F172A',
              }}
            >
              Has P&L
            </span>
          </label>
        </div>

        {/* Bottom divider */}
        <div
          style={{
            width: '100%',
            height: '1px',
            background: '#D5DEEA',
            margin: '16px 0',
          }}
        />

        {/* Action buttons */}
        <div
          style={{
            display: 'flex',
            gap: '16px',
            padding: '0 20px 20px',
          }}
        >
          {/* Reset button */}
          <button
            onClick={handleReset}
            style={{
              flex: 1,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '12px 16px',
              background: 'transparent',
              border: '1px solid #D5DEEA',
              borderRadius: '14px',
              boxShadow: 'none',
              cursor: 'pointer',
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 600,
              fontSize: '14px',
              lineHeight: '20px',
              letterSpacing: '0.01em',
              textTransform: 'capitalize',
              color: '#334155',
            }}
          >
            Reset
          </button>

          {/* Apply button */}
          <button
            onClick={handleApply}
            disabled={!hasFloating && !hasCredit && !noDeposit && !hasPnl}
            style={{
              flex: 1,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '12px 16px',
              background: (hasFloating || hasCredit || noDeposit || hasPnl) ? '#2563EB' : 'rgba(37, 99, 235, 0.28)',
              border: '1px solid ' + ((hasFloating || hasCredit || noDeposit || hasPnl) ? '#2563EB' : 'transparent'),
              borderRadius: '14px',
              boxShadow: 'none',
              cursor: (hasFloating || hasCredit || noDeposit || hasPnl) ? 'pointer' : 'not-allowed',
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 600,
              fontSize: '14px',
              lineHeight: '20px',
              letterSpacing: '0.01em',
              textTransform: 'capitalize',
              color: (hasFloating || hasCredit || noDeposit || hasPnl) ? '#FFFFFF' : '#FFFFFF',
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </>
  );
};

export default FilterModal;
