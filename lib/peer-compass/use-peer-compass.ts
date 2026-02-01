'use client';

/**
 * usePeerCompass Hook
 * 
 * This hook manages peer-to-peer compass discovery and direction hints.
 * It handles:
 * - Device orientation tracking (heading)
 * - Geolocation (latitude/longitude)
 * - WebRTC peer connection
 * - Bearing calculations
 * 
 * Usage:
 * const { status, directionHint, distanceEstimate } = usePeerCompass();
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { WebRTCPeer, PeerData, PeerCompassState } from './webrtc-peer';
import {
  calculateBearing,
  calculateDistance,
  getDirectionHint,
  formatDistance,
} from './bearing';
import { wsClient, type PeerDeviceData } from '@/lib/peer/wsClient';
import { useDeviceId } from '@/hooks/use-device-id';

export interface UsePeerCompassResult {
  // Connection status
  status: 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';
  
  // Direction hint for user
  directionHint: 'facing-each-other' | 'turn-left' | 'turn-right' | 'not-aligned' | null;
  
  // Distance estimate to peer
  distanceEstimate: string | null;
  
  // Error message if any
  error: string | null;
  
  // Local device data
  localHeading: number | null;
  localLocation: { latitude: number; longitude: number } | null;
  // Bearing values
  bearingToPeer: number | null;
  relativeBearing: number | null; // raw relative (bearing - heading)
  rotation: number | null; // smoothed rotation to apply to UI
  
  // Remote peer data
  remotePeerData: PeerData | null;
  
  // Actions
  initiateSession: (roomId: string) => Promise<void>;
  joinSession: (roomId: string, offerDescription: RTCSessionDescriptionInit) => Promise<void>;
  disconnect: () => void;
  setTargetDeviceId: (id: string | null) => void;
}

export function usePeerCompass(): UsePeerCompassResult {
  const peerRef = useRef<WebRTCPeer | null>(null);
  const orientationListenerRef = useRef<((event: DeviceOrientationEvent) => void) | null>(null);
  const geoWatchRef = useRef<number | null>(null);

  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error' | 'disconnected'>('idle');
  const [directionHint, setDirectionHint] = useState<'facing-each-other' | 'turn-left' | 'turn-right' | 'not-aligned' | null>(null);
  const [distanceEstimate, setDistanceEstimate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localHeading, setLocalHeading] = useState<number | null>(null);
  const [remotePeerData, setRemotePeerData] = useState<PeerData | null>(null);
  const [targetDeviceId, setTargetDeviceId] = useState<string | null>(null);
  const [bearingToPeer, setBearingToPeer] = useState<number | null>(null);
  const [relativeBearing, setRelativeBearing] = useState<number | null>(null);
  const [smoothedRelative, setSmoothedRelative] = useState<number | null>(null);

  const [localLocation, setLocalLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  const deviceId = useDeviceId();

  // Fallback simulated heading/location for demo purposes
  const simulatedHeadingRef = useRef<number>(0);
  const simulatedLocationRef = useRef<{ latitude: number; longitude: number }>({
    latitude: 40.7128 + Math.random() * 0.01,
    longitude: -74.006 + Math.random() * 0.01,
  });

  /**
   * Set up device orientation tracking
   * Fallback to simulated heading if DeviceOrientationEvent unavailable
   */
  useEffect(() => {
    // Try to use DeviceOrientationEvent first
    const handleDeviceOrientation = (event: DeviceOrientationEvent) => {
      // webkitCompassHeading is iOS, alpha is standard
      const heading = event.webkitCompassHeading ?? event.alpha ?? 0;
      setLocalHeading(heading);
      simulatedHeadingRef.current = heading;
    };

    if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      try {
        // Some browsers require user permission
        if ('requestPermission' in DeviceOrientationEvent) {
          DeviceOrientationEvent.requestPermission()
            .then((permission) => {
              if (permission === 'granted') {
                window.addEventListener('deviceorientation', handleDeviceOrientation);
                orientationListenerRef.current = handleDeviceOrientation;
              } else {
                console.warn('[Peer Compass] Device orientation permission denied, using simulated heading');
                startSimulatedHeading();
              }
            })
            .catch((err) => {
              console.warn('[Peer Compass] Failed to request device orientation permission:', err);
              startSimulatedHeading();
            });
        } else {
          // No permission required (Android, older browsers)
          window.addEventListener('deviceorientation', handleDeviceOrientation);
          orientationListenerRef.current = handleDeviceOrientation;
        }
      } catch (err) {
        console.warn('[Peer Compass] DeviceOrientationEvent not available, using simulated heading:', err);
        startSimulatedHeading();
      }
    } else {
      console.warn('[Peer Compass] DeviceOrientationEvent not supported, using simulated heading');
      startSimulatedHeading();
    }

    return () => {
      if (orientationListenerRef.current) {
        window.removeEventListener('deviceorientation', orientationListenerRef.current);
        orientationListenerRef.current = null;
      }
    };
  }, []);

  /**
   * Start simulated heading rotation for demo/fallback
   */
  const startSimulatedHeading = useCallback(() => {
    const interval = setInterval(() => {
      simulatedHeadingRef.current = (simulatedHeadingRef.current + 0.5) % 360;
      setLocalHeading(simulatedHeadingRef.current);
    }, 50);

    return () => clearInterval(interval);
  }, []);

  /**
   * Set up geolocation tracking
   * Fallback to simulated location if GPS unavailable
   */
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      try {
        geoWatchRef.current = navigator.geolocation.watchPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            setLocalLocation({ latitude, longitude });
            simulatedLocationRef.current = { latitude, longitude };
          },
          (err) => {
            console.warn('[Peer Compass] Geolocation error, using simulated location:', err.message);
            setLocalLocation(simulatedLocationRef.current);
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 5000,
          }
        );
      } catch (err) {
        console.warn('[Peer Compass] Geolocation not available:', err);
        setLocalLocation(simulatedLocationRef.current);
      }
    } else {
      console.warn('[Peer Compass] Geolocation not supported');
      setLocalLocation(simulatedLocationRef.current);
    }

    return () => {
      if (geoWatchRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchRef.current);
      }
    };
  }, []);

  /**
   * Initialize WebSocket connection and handle peer data
   */
  useEffect(() => {
    const handleIncomingData = (data: PeerDeviceData) => {
      // Convert WebSocket data to PeerData format
      const peerData: PeerData = {
        heading: data.heading,
        latitude: data.location.latitude,
        longitude: data.location.longitude,
        timestamp: data.timestamp,
        deviceId: data.deviceId ?? 'remote-peer',
      };
      // If a target device is selected, only accept data from that device
      if (targetDeviceId && peerData.deviceId !== targetDeviceId) {
        return;
      }
      setRemotePeerData(peerData);
      setStatus('connected');
    };

    wsClient.connectPeer(handleIncomingData).catch((err) => {
      console.warn('[v0] WebSocket connection failed:', err);
    });

    return () => {
      wsClient.disconnect();
    };
  }, []);

  /**
   * Update peer data and send to remote peer via WebSocket
   */
  useEffect(() => {
    if (localHeading === null || !localLocation) return;

    // Send local device data periodically via WebSocket
    const interval = setInterval(() => {
      const deviceData: PeerDeviceData = {
        deviceId,
        heading: localHeading,
        location: {
          latitude: localLocation.latitude,
          longitude: localLocation.longitude,
        },
        timestamp: Date.now(),
      };
      wsClient.sendPeer(deviceData);
    }, 1000); // Send every second

    return () => clearInterval(interval);
  }, [localHeading, localLocation]);

  /**
   * Update direction hint and distance based on peer data
   */
  useEffect(() => {
    if (localHeading === null || !localLocation || !remotePeerData) {
      setDirectionHint(null);
      setDistanceEstimate(null);
      return;
    }

    // Calculate bearing from local to remote
    const bearing = calculateBearing(
      localLocation.latitude,
      localLocation.longitude,
      remotePeerData.latitude,
      remotePeerData.longitude
    );

    const distance = calculateDistance(
      localLocation.latitude,
      localLocation.longitude,
      remotePeerData.latitude,
      remotePeerData.longitude
    );

    // Relative bearing: target bearing minus device heading (normalize to -180..180)
    let rel = bearing - localHeading;
    if (rel > 180) rel -= 360;
    if (rel < -180) rel += 360;

    // Update state values
    setBearingToPeer(bearing);
    setRelativeBearing(rel);

    // Get direction hint
    const hint = getDirectionHint(localHeading, bearing);
    setDirectionHint(hint);

    // Format distance
    setDistanceEstimate(formatDistance(distance));
  }, [localHeading, localLocation, remotePeerData]);

  /**
   * Smooth the relative bearing using a simple lerp on animation frames
   */
  const smoothedRef = useRef<number | null>(null);
  const targetRef = useRef<number | null>(null);

  useEffect(() => {
    targetRef.current = relativeBearing;
  }, [relativeBearing]);

  useEffect(() => {
    let raf = 0;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const loop = () => {
      const target = targetRef.current;
      if (target == null) {
        smoothedRef.current = null;
        setSmoothedRelative(null);
      } else {
        let cur = smoothedRef.current ?? target;

        // Compute shortest angular difference
        let diff = target - cur;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;

        const next = cur + diff * 0.15; // smoothing factor
        // Normalize to -180..180
        let normalized = next;
        if (normalized > 180) normalized -= 360;
        if (normalized < -180) normalized += 360;

        smoothedRef.current = normalized;
        setSmoothedRelative(normalized);
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  /**
   * Subscribe to peer state changes
   */
  useEffect(() => {
    if (!peerRef.current) return;

    const unsubscribe = peerRef.current.subscribe((peerState: PeerCompassState) => {
      setStatus(peerState.status);
      setRemotePeerData(peerState.remotePeerData);
      setError(peerState.error);
    });

    return unsubscribe;
  }, []);

  /**
   * Initiate a new peer session as initiator
   */
  const initiateSession = useCallback(async (roomId: string) => {
    try {
      if (!peerRef.current) {
        peerRef.current = new WebRTCPeer();
      }
      await peerRef.current.initiateConnection(roomId);
    } catch (err) {
      setError(`Failed to initiate session: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, []);

  /**
   * Join an existing peer session
   */
  const joinSession = useCallback(
    async (roomId: string, offerDescription: RTCSessionDescriptionInit) => {
      try {
        if (!peerRef.current) {
          peerRef.current = new WebRTCPeer();
        }
        await peerRef.current.joinConnection(roomId, offerDescription);
      } catch (err) {
        setError(`Failed to join session: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    []
  );

  /**
   * Disconnect from peer
   */
  const disconnect = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.disconnect();
    }
    setDirectionHint(null);
    setDistanceEstimate(null);
    setRemotePeerData(null);
    setTargetDeviceId(null);
  }, []);

  const setTargetDevice = useCallback((id: string | null) => {
    setTargetDeviceId(id);
    // if clearing target, also clear current remote data
    if (id === null) setRemotePeerData(null);
  }, []);

  return {
    status,
    directionHint,
    distanceEstimate,
    error,
    localHeading,
    localLocation,
    bearingToPeer,
    relativeBearing,
    rotation: smoothedRelative,
    remotePeerData,
    // actions
    setTargetDeviceId: setTargetDevice,
    initiateSession,
    joinSession,
    disconnect,
  };
}
