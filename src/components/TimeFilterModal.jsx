import React, { useState, useEffect } from 'react';

const TimeFilterModal = ({ 
  isOpen, 
  onClose, 
  onApply,
  currentFilter = '24h',
  customFromDate = '',
  customToDate = '',
  onCustomFromDateChange,
  onCustomToDateChange,
  onApplyCustomDates,
  onPendingChange
}) => {
  const [selectedFilter, setSelectedFilter] = useState(currentFilter);

  useEffect(() => {
    if (isOpen) {
      setSelectedFilter(currentFilter);
    }
  }, [isOpen, currentFilter]);

  // Notify parent about pending selection
  useEffect(() => {
    if (!isOpen) return
    if (onPendingChange) {
      const hasPending = selectedFilter !== currentFilter || (selectedFilter==='custom')
      const draft = { type: selectedFilter, from: customFromDate, to: customToDate }
      try {
        onPendingChange(hasPending, draft)
      } catch {
        onPendingChange(hasPending)
      }
    }
  }, [isOpen, selectedFilter, currentFilter, customFromDate, customToDate, onPendingChange]);

  if (!isOpen) return null;

  const handleApply = () => {
    if (selectedFilter === 'custom') {
      // For custom, validate dates first
      if (!customFromDate || !customToDate) {
        alert('Please select both From Date and To Date');
        return;
      }
      const fromDate = new Date(customFromDate);
      const toDate = new Date(customToDate);
      if (fromDate > toDate) {
        alert('From Date cannot be after To Date');
        return;
      }
      if (onApplyCustomDates) {
        onApplyCustomDates();
      }
    }
    onApply(selectedFilter);
    onClose();
  };

  const handleReset = () => {
    setSelectedFilter('24h');
    onApply('24h');
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

      {/* Hide the floating Ask AI button while this sheet is open */}

      <style>{'.ask-ai-fab { display: none !important; }'}</style>


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
            borderRadius: '100px',
            margin: '12px auto 0',
          }}
        />

        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '20px 20px 16px',
            borderBottom: '1px solid #D5DEEA',
          }}
        >
          <button
            onClick={onClose}
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M15 18L9 12L15 6" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <h2
            style={{
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 800,
              fontSize: '18px',
              lineHeight: '23px',
              color: '#0F172A',
              letterSpacing: '-0.02em',
              margin: '0 0 0 12px',
              flex: 1,
            }}
          >
            Filter
          </h2>
        </div>

        {/* Filter Options */}
        <div
          style={{
            padding: '16px 20px 6px',
            flex: 1,
            overflowY: 'auto',
          }}
        >
          {/* Last 24 hours */}
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
              checked={selectedFilter === '24h'}
              onChange={(e) => setSelectedFilter(e.target.checked ? '24h' : selectedFilter)}
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
              Last 24 hours
            </span>
          </label>

          {/* Last 7 Days */}
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
              checked={selectedFilter === '7d'}
              onChange={(e) => setSelectedFilter(e.target.checked ? '7d' : selectedFilter)}
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
              Last 7 Days
            </span>
          </label>

          {/* Custom Range */}
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
              checked={selectedFilter === 'custom'}
              onChange={(e) => setSelectedFilter(e.target.checked ? 'custom' : selectedFilter)}
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
              Custom Range
            </span>
          </label>

          {/* Custom Date Inputs */}
          {selectedFilter === 'custom' && (
            <div style={{ padding: '16px 0' }}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{
                  fontFamily: 'Outfit, sans-serif',
                  fontSize: '14px',
                  color: '#666',
                  display: 'block',
                  marginBottom: '6px'
                }}>From Date</label>
                <input
                  type="date"
                  value={customFromDate}
                  onChange={(e) => onCustomFromDateChange && onCustomFromDateChange(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #D5DEEA',
                    borderRadius: '12px',
                    fontFamily: 'Outfit, sans-serif',
                    fontSize: '14px',
                    color: '#000000',
                    backgroundColor: 'transparent'
                  }}
                />
              </div>
              <div>
                <label style={{
                  fontFamily: 'Outfit, sans-serif',
                  fontSize: '14px',
                  color: '#666',
                  display: 'block',
                  marginBottom: '6px'
                }}>To Date</label>
                <input
                  type="date"
                  value={customToDate}
                  onChange={(e) => onCustomToDateChange && onCustomToDateChange(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #D5DEEA',
                    borderRadius: '12px',
                    fontFamily: 'Outfit, sans-serif',
                    fontSize: '14px',
                    color: '#000000',
                    backgroundColor: 'transparent'
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            padding: '16px 20px 24px',
            borderTop: '1px solid #D5DEEA',
          }}
        >
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
          <button
            onClick={handleApply}
            style={{
              flex: 1,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '12px 16px',
              background: '#2563EB',
              border: '1px solid #2563EB',
              borderRadius: '14px',
              boxShadow: 'none',
              cursor: 'pointer',
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 600,
              fontSize: '14px',
              lineHeight: '20px',
              letterSpacing: '0.01em',
              textTransform: 'capitalize',
              color: '#FFFFFF',
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </>
  );
};

export default TimeFilterModal;
