'use client';

import { useState, useEffect } from 'react';
import { Accessibility, X, Type, Eye, Zap, AlignJustify } from 'lucide-react';

export interface AccessibilitySettings {
  dyslexiaFont: boolean;
  fontSize: 'normal' | 'large' | 'larger';
  highContrast: boolean;
  increaseSpacing: boolean;
  reduceMotion: boolean;
}

const defaultSettings: AccessibilitySettings = {
  dyslexiaFont: false,
  fontSize: 'normal',
  highContrast: false,
  increaseSpacing: false,
  reduceMotion: false,
};

function applySettings(s: AccessibilitySettings) {
  const html = document.documentElement;
  html.classList.toggle('dyslexia-font', s.dyslexiaFont);
  html.classList.toggle('high-contrast', s.highContrast);
  html.classList.toggle('increase-spacing', s.increaseSpacing);
  html.classList.toggle('reduce-motion', s.reduceMotion);
  html.classList.remove('text-size-large', 'text-size-larger');
  if (s.fontSize !== 'normal') {
    html.classList.add(`text-size-${s.fontSize}`);
  }
}

interface ToggleRowProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ icon, label, description, checked, onChange }: ToggleRowProps) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors text-left ${
        checked
          ? 'bg-blue-600/20 border border-blue-500/30'
          : 'hover:bg-gray-800 border border-transparent'
      }`}
      role="switch"
      aria-checked={checked}
      aria-label={`${label}: ${checked ? 'on' : 'off'}`}
    >
      <div className={`flex-shrink-0 ${checked ? 'text-blue-400' : 'text-gray-400'}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium ${checked ? 'text-blue-300' : 'text-gray-200'}`}>
          {label}
        </div>
        <div className="text-xs text-gray-500 truncate">{description}</div>
      </div>
      {/* Toggle switch */}
      <div
        className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-gray-700'
        }`}
        aria-hidden="true"
      >
        <div
          className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </div>
    </button>
  );
}

export default function AccessibilityPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [settings, setSettings] = useState<AccessibilitySettings>(defaultSettings);

  // Load persisted settings on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('accessibility-settings');
      if (saved) {
        const parsed: AccessibilitySettings = { ...defaultSettings, ...JSON.parse(saved) };
        setSettings(parsed);
        applySettings(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  const update = <K extends keyof AccessibilitySettings>(key: K, value: AccessibilitySettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    applySettings(next);
    try {
      localStorage.setItem('accessibility-settings', JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const reset = () => {
    setSettings(defaultSettings);
    applySettings(defaultSettings);
    try {
      localStorage.removeItem('accessibility-settings');
    } catch {
      // ignore
    }
  };

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className={`fixed bottom-20 right-4 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-black ${
          isOpen ? 'bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
        }`}
        aria-label={isOpen ? 'Close accessibility panel' : 'Open accessibility panel'}
        aria-expanded={isOpen}
        title="Accessibility options"
      >
        <Accessibility className="w-5 h-5" aria-hidden="true" />
      </button>

      {/* Floating panel */}
      {isOpen && (
        <div
          className="fixed bottom-36 right-4 z-50 w-72 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-4"
          role="dialog"
          aria-modal="false"
          aria-label="Accessibility settings"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Accessibility className="w-4 h-4" aria-hidden="true" />
              Accessibility
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={reset}
                className="text-xs text-gray-400 hover:text-white transition-colors px-1 py-0.5 rounded hover:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-500"
                aria-label="Reset all accessibility settings to default"
              >
                Reset
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-800 rounded transition-colors focus:outline-none focus:ring-1 focus:ring-gray-500"
                aria-label="Close accessibility panel"
              >
                <X className="w-4 h-4 text-gray-400" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {/* Dyslexia-friendly font */}
            <ToggleRow
              icon={<Type className="w-4 h-4" aria-hidden="true" />}
              label="Dyslexia-friendly font"
              description="OpenDyslexic typeface"
              checked={settings.dyslexiaFont}
              onChange={v => update('dyslexiaFont', v)}
            />

            {/* High contrast */}
            <ToggleRow
              icon={<Eye className="w-4 h-4" aria-hidden="true" />}
              label="High contrast"
              description="Increase color contrast"
              checked={settings.highContrast}
              onChange={v => update('highContrast', v)}
            />

            {/* Increase spacing */}
            <ToggleRow
              icon={<AlignJustify className="w-4 h-4" aria-hidden="true" />}
              label="Increase spacing"
              description="More line & letter spacing"
              checked={settings.increaseSpacing}
              onChange={v => update('increaseSpacing', v)}
            />

            {/* Reduce motion */}
            <ToggleRow
              icon={<Zap className="w-4 h-4" aria-hidden="true" />}
              label="Reduce motion"
              description="Minimise animations"
              checked={settings.reduceMotion}
              onChange={v => update('reduceMotion', v)}
            />

            {/* Text size */}
            <div className="flex items-center gap-3 p-2 rounded-lg border border-transparent">
              <div className="text-gray-400 flex-shrink-0" aria-hidden="true">
                <Type className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-200">Text size</div>
                <div className="text-xs text-gray-500">Scale body text</div>
              </div>
              <div className="flex items-center gap-1" role="group" aria-label="Text size options">
                {(
                  [
                    { value: 'normal', label: 'A', title: 'Normal text size', className: 'text-xs' },
                    { value: 'large', label: 'A', title: 'Large text size', className: 'text-sm' },
                    { value: 'larger', label: 'A', title: 'Extra large text size', className: 'text-base' },
                  ] as const
                ).map(({ value, label, title, className }) => (
                  <button
                    key={value}
                    onClick={() => update('fontSize', value)}
                    className={`w-8 h-8 rounded flex items-center justify-center transition-colors focus:outline-none focus:ring-1 focus:ring-blue-400 ${className} ${
                      settings.fontSize === value
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                    aria-label={title}
                    aria-pressed={settings.fontSize === value}
                    title={title}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="mt-3 text-xs text-gray-600 text-center">
            Settings saved automatically
          </p>
        </div>
      )}
    </>
  );
}
