'use client';

import React, { useEffect, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout
} from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string);

interface CheckoutModalProps {
  priceId: string;
  onClose: () => void;
}

export default function CheckoutModal({ priceId, onClose }: CheckoutModalProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) return;
        if (data.clientSecret) {
          setClientSecret(data.clientSecret);
        } else {
          setError(data.error || 'Failed to initialize secure checkout session.');
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error('Error fetching client secret:', err);
        setError('Network error. Please check your connection.');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [priceId]);

  // Lock background scroll when modal is active
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-xl animate-fadeIn transition-all duration-300">
      
      {/* Outer Glow / Ambient Lighting Effect */}
      <div className="absolute w-[320px] h-[320px] sm:w-[500px] sm:h-[500px] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Main Modal Box with Stake Dark Surface & Subtle Border Gradient */}
      <div className="relative w-full max-w-xl bg-[#0f1923]/95 border border-emerald-500/20 rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col max-h-[92vh] transform transition-all animate-scaleUp">
        
        {/* Top Accent Neon Line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-500 to-transparent opacity-80" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800/80 bg-[#121c26]/80 backdrop-blur-md">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
              ⚡
            </div>
            <div>
              <h3 className="text-white font-bold text-base tracking-wide flex items-center gap-2">
                Instant Vault Deposit
              </h3>
              <p className="text-gray-400 text-xs">Encrypted & Secure Payment Gateway</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-[#1b2733] border border-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-800 transition-all flex items-center justify-center text-sm font-bold group"
            aria-label="Close modal"
          >
            <span className="group-hover:rotate-90 transition-transform duration-200">✕</span>
          </button>
        </div>

        {/* Modal Body / Stripe Component Shell */}
        <div className="p-6 overflow-y-auto w-full bg-[#070d14] custom-scrollbar flex-1">
          {error ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 text-xl">
                ⚠️
              </div>
              <div className="space-y-1">
                <h4 className="text-white font-semibold text-sm">Checkout Error</h4>
                <p className="text-red-400 text-xs max-w-sm">{error}</p>
              </div>
              <button
                onClick={onClose}
                className="mt-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-xl text-xs font-semibold transition-colors"
              >
                Dismiss
              </button>
            </div>
          ) : clientSecret ? (
            <div className="rounded-2xl overflow-hidden bg-[#0f1923] border border-gray-800/60 shadow-inner">
              <EmbeddedCheckoutProvider
                stripe={stripePromise}
                options={{ clientSecret }}
              >
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 space-y-5">
              <div className="relative">
                {/* Pulsing Casino-style Loader Spinner */}
                <div className="w-12 h-12 rounded-full border-2 border-emerald-500/20 border-t-emerald-500 animate-spin" />
                <div className="absolute inset-0 rounded-full bg-emerald-500/10 blur-md animate-pulse" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-white text-sm font-semibold tracking-wide">Establishing Secure Session</p>
                <p className="text-gray-400 text-xs">Preparing encrypted payment parameters...</p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Security Badge */}
        <div className="px-6 py-3 bg-[#0a1017] border-t border-gray-800/60 flex items-center justify-between text-[11px] text-gray-300">
          <div className="flex items-center space-x-1.5 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>256-Bit SSL Encryption</span>
          </div>
          <div className="text-gray-400 font-medium">Powered by Stripe & Vault Engine</div>
        </div>

      </div>
    </div>
  );
}