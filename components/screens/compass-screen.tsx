'use client';

import React, { useState, useEffect } from 'react';
import { useEmergency } from '@/lib/emergency-context';
import { CompassNavigation } from '@/components/compass-navigation';
import { usePeerCompass } from '@/lib/peer-compass';
import { useDeviceId } from '@/hooks/use-device-id';
import { cn } from '@/lib/utils';

interface CompassScreenProps {
  onClose?: () => void;
  destination?: string;
  bearing?: number;
  distance?: number;
}

export function CompassScreen({
  onClose,
  destination = 'Safety Zone',
  bearing = 0,
  distance = 0,
}: CompassScreenProps) {
  const { disasterType, connectivity, uiMode } = useEmergency();
  const compass = usePeerCompass();
  const deviceId = useDeviceId();
  
  const [manualBearing, setManualBearing] = useState(bearing);
  const [manualDistance, setManualDistance] = useState(distance);
  const [useManual, setUseManual] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [showPeerSelector, setShowPeerSelector] = useState(false);

  // Use live compass data if available and not in manual mode
  const displayBearing = useManual ? manualBearing : (compass.rotation ?? bearing);

  const parseDistanceEstimate = (s: string | null) => {
    if (!s) return distance;
    if (s.includes('m')) return parseFloat(s.replace('m','')) / 1000;
    if (s.includes('km')) return parseFloat(s.replace('km',''));
    return parseFloat(s) || distance;
  };

  const displayDistance = useManual ? manualDistance : parseDistanceEstimate(compass.distanceEstimate);
  const displayDestination = compass.remotePeerData?.deviceId || destination;
  
  // Handle target device selection
  const handleSelectPeer = (deviceId: string) => {
    compass.setTargetDeviceId(deviceId);
    setShowPeerSelector(false);
  };

  const handleManualTargetInput = (e: React.FormEvent) => {
    e.preventDefault();
    if (targetInput.trim()) {
      compass.setTargetDeviceId(targetInput.toUpperCase());
      setTargetInput('');
      setShowPeerSelector(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-between min-h-screen bg-background p-4">
      {/* Header */}
      <div className="w-full">
        <button
          onClick={onClose}
          className={cn(
            'px-4 py-2 rounded-lg font-bold mb-4',
            'bg-card border-2 border-foreground text-foreground',
            'hover:brightness-110 transition-all'
          )}
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-foreground">Navigation Compass</h1>
        <p className="text-muted-foreground">{destination}</p>
      </div>

      {/* Device ID Badge */}
      {!useManual && deviceId && (
        <div className="mb-4 px-3 py-2 bg-muted rounded-lg text-xs text-muted-foreground text-center">
          Your ID: <span className="font-bold text-foreground">{deviceId}</span>
        </div>
      )}

      {/* Compass */}
      <div className="flex-1 flex items-center justify-center w-full">
        <CompassNavigation
          bearing={displayBearing}
          distance={displayDistance}
          destination={displayDestination}
          isActive={!useManual && compass.localHeading !== null}
        />
      </div>

      {/* Controls */}
      {uiMode !== 'critical' && (
        <div className="w-full space-y-4">
          {/* Peer Selection */}
          {!useManual && (
            <div className="bg-card border-2 border-border rounded-lg p-4 space-y-3">
              <div className="font-bold text-foreground text-sm">Target Device</div>

              {compass.remotePeerData ? (
                <div className="bg-safe/20 border-2 border-safe rounded-lg p-3">
                  <div className="text-xs text-safe-foreground mb-1">Connected to:</div>
                  <div className="text-lg font-bold text-safe">{compass.remotePeerData.deviceId}</div>
                  <div className="text-xs text-safe-foreground mt-2">Distance: {compass.distanceEstimate || 'calculating...'}</div>
                  <button
                    onClick={() => compass.disconnect()}
                    className="mt-3 w-full px-3 py-1 bg-safe text-safe-foreground rounded text-xs font-bold hover:brightness-110"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Waiting for peer...</div>
              )}
            </div>
          )}

          {/* Manual Entry Option */}
          {connectivity === 'offline' && (
            <div className="bg-caution/20 border-2 border-caution rounded-lg p-4 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useManual}
                  onChange={(e) => setUseManual(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-caution-foreground font-bold">Manual Entry</span>
              </label>

              {useManual && (
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-caution-foreground block mb-1">
                      Direction (0-360°)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="360"
                      value={manualBearing}
                      onChange={(e) => setManualBearing(Math.min(360, Math.max(0, Number(e.target.value))))}
                      className="w-full px-3 py-2 bg-input border-2 border-caution rounded text-caution-foreground font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-caution-foreground block mb-1">
                      Distance (km)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={manualDistance}
                      onChange={(e) => setManualDistance(Math.max(0, Number(e.target.value)))}
                      className="w-full px-3 py-2 bg-input border-2 border-caution rounded text-caution-foreground font-bold"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sensor Status */}
          <div className="bg-card border-2 border-border rounded-lg p-3 space-y-2 text-sm">
            <div className={cn(
              'flex items-center gap-2',
              compass.localHeading !== null ? 'text-safe' : 'text-caution'
            )}>
              <span>{compass.localHeading !== null ? '✓' : '⚠'}</span>
              <span>Compass {compass.localHeading !== null ? 'Active' : 'Unavailable'}</span>
              {compass.error && <span className="text-xs">({compass.error})</span>}
            </div>
            <div className={cn(
              'flex items-center gap-2',
              compass.localLocation ? 'text-safe' : 'text-caution'
            )}>
              <span>{compass.localLocation ? '✓' : '⚠'}</span>
              <span>Location {compass.localLocation ? 'Active' : 'Unavailable'}</span>
            </div>
            {compass.remotePeerData && (
              <div className="text-safe flex items-center gap-2">
                <span>✓</span>
                <span>Target Connected</span>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="bg-card border-2 border-foreground rounded-lg p-3 space-y-2">
            <div className="font-bold text-foreground text-sm">How to navigate:</div>
            <ol className="text-xs text-muted-foreground space-y-1">
              <li>1. Face the direction shown by the arrow</li>
              <li>2. Walk straight in that direction</li>
              <li>3. Keep the device level for best accuracy</li>
              <li>4. Distance decreases as you get closer</li>
            </ol>
          </div>

          <button
            onClick={onClose}
            className="w-full px-4 py-3 bg-safe text-safe-foreground rounded-lg font-bold hover:brightness-110 transition-all"
          >
            Done
          </button>
        </div>
      )}

      {/* Critical Mode - Minimal */}
      {uiMode === 'critical' && (
        <button
          onClick={onClose}
          className="px-8 py-4 bg-danger text-danger-foreground rounded-lg font-bold text-lg hover:brightness-110 transition-all"
        >
          Return to Home
        </button>
      )}
    </div>
  );
}
