import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { CircleHelp, X, ArrowRight, ArrowLeft } from 'lucide-react';
import type { OnboardingProgress } from '@eliza/contracts';
import { api, queryClient } from '../api';
import { t, useLanguage } from '../i18n';
import { Button } from '../components/ui/button';
import { onboardingPage, pageTours, type TourStep } from './tours';
import { placeTourCard, type Box } from './placement';
import { progressId, readTours, saveTour, tourStorageKey } from './state';
import './onboarding.css';

const inFlight = new Set<string>();
function otherDialogOpen() {
  return [...document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"]')].some(
    (element) =>
      !element.hasAttribute('data-onboarding-dialog') && element.getClientRects().length > 0,
  );
}
function findTarget(root: Element | null, selector: string) {
  return [...(root?.querySelectorAll<HTMLElement>(selector) ?? [])].find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  });
}

export function PageOnboarding({
  storeId,
  employeeId,
  endpoint,
  scope = '[data-tour-scope="management"]',
  autoStart = true,
}: {
  storeId: string;
  employeeId: string;
  endpoint?: string;
  scope?: string;
  autoStart?: boolean;
}) {
  useLanguage();
  const pathname = useLocation().pathname;
  const pageId = onboardingPage(pathname);
  // A route/account change gets a separate lifecycle, including dialog cleanup.
  return pageId ? (
    <Walkthrough
      key={`${storeId}:${employeeId}:${pathname}`}
      {...{ storeId, employeeId, endpoint, scope, autoStart, pageId }}
    />
  ) : null;
}
function Walkthrough({
  storeId,
  employeeId,
  endpoint,
  scope,
  autoStart,
  pageId,
}: {
  storeId: string;
  employeeId: string;
  endpoint?: string;
  scope: string;
  autoStart: boolean;
  pageId: NonNullable<ReturnType<typeof onboardingPage>>;
}) {
  useLanguage();
  const tour = pageTours[pageId];
  const key = tourStorageKey(storeId, employeeId);
  const [cache, setCache] = useState(() => readTours(key));
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [geometry, setGeometry] = useState<{
    target: Box;
    card: { left: number; top: number };
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const restored = useRef(false);
  const automatic = useRef(false);
  const interacted = useRef(false);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const queryKey = ['onboarding', storeId, employeeId];
  const progress = useQuery({
    queryKey,
    queryFn: () => api<OnboardingProgress[]>(endpoint!),
    enabled: !!endpoint,
  });
  const currentProgress = { pageId, version: tour.version };
  const seen =
    Object.values(cache).some((p) => p.pageId === pageId && p.version >= tour.version) ||
    progress.data?.some((p) => p.pageId === pageId && p.version >= tour.version);

  async function sync(value: OnboardingProgress) {
    if (!endpoint) return;
    const id = key + ':' + progressId(value);
    if (inFlight.has(id)) return;
    inFlight.add(id);
    try {
      await api(endpoint, value);
      if (readTours(key)[progressId(value)]?.status === value.status)
        setCache(saveTour(key, value, false));
      queryClient.setQueryData<OnboardingProgress[]>(queryKey, (old) => [
        ...(old ?? []).filter((p) => progressId(p) !== progressId(value)),
        value,
      ]);
    } catch {
      /* A local acknowledgement prevents repeat prompts; retry on a later successful load. */
    } finally {
      inFlight.delete(id);
    }
  }
  useEffect(() => {
    if (progress.isSuccess && endpoint)
      for (const value of Object.values(readTours(key))) if (value.pending) void sync(value);
  }, [key, endpoint, progress.dataUpdatedAt]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key) setCache(readTours(key));
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [key]);

  function begin() {
    if (otherDialogOpen()) return;
    const root = document.querySelector(scope);
    const available = tour.steps.filter((step) => findTarget(root, step.selector));
    if (!available.length) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    restored.current = false;
    automatic.current = true;
    setIndex(0);
    setGeometry(null);
    setSteps(available);
  }
  function finish(status: OnboardingProgress['status']) {
    const value = { ...currentProgress, status };
    setCache(saveTour(key, value, !!endpoint));
    void sync(value);
    setSteps(null);
  }
  useEffect(() => {
    if (!autoStart || seen || automatic.current || steps || (endpoint && progress.isPending))
      return;
    let timer: ReturnType<typeof setTimeout>;
    const interaction = () => {
      interacted.current = true;
    };
    const check = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (interacted.current || otherDialogOpen()) return;
        const root = document.querySelector(scope);
        // Never interrupt a cashier who has already started a cart.
        if (pageId === 'pos' && root?.querySelector('.cart-line')) return;
        if (findTarget(root, tour.steps[0].selector)) begin();
      }, 650);
    };
    const observer = new MutationObserver(check);
    const root = document.querySelector(scope);
    if (root) observer.observe(root, { childList: true, subtree: true });
    window.addEventListener('pointerdown', interaction, true);
    window.addEventListener('keydown', interaction, true);
    check();
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('pointerdown', interaction, true);
      window.removeEventListener('keydown', interaction, true);
    };
  }, [seen, steps, progress.isPending, pageId, endpoint, autoStart, scope]);

  useLayoutEffect(() => {
    if (!steps || !dialog.current) return;
    const element = dialog.current;
    if (!element.open) element.showModal();
    const oldOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      element.close();
      document.documentElement.style.overflow = oldOverflow;
      if (!restored.current) {
        restored.current = true;
        if (previousFocus.current?.isConnected)
          previousFocus.current.focus({ preventScroll: true });
      }
    };
  }, [!!steps]);
  useLayoutEffect(() => {
    if (!steps) return;
    const root = document.querySelector(scope);
    const target = findTarget(root, steps[index].selector);
    target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    let frame = 0;
    const measure = () => {
      const element = findTarget(root, steps[index].selector);
      const rect = element?.getBoundingClientRect();
      const width = document.documentElement.clientWidth,
        height = window.innerHeight;
      const left = Math.max(8, (rect?.left ?? width / 2) - 6);
      const top = Math.max(8, (rect?.top ?? 40) - 6);
      const box = {
        left,
        top,
        width: Math.max(0, Math.min(width - 8, rect?.right ?? left) - left + 6),
        height: Math.max(0, Math.min(height - 8, rect?.bottom ?? top) - top + 6),
      };
      const size = card.current?.getBoundingClientRect();
      const position = placeTourCard(
        box,
        { width, height },
        { width: size?.width ?? 360, height: size?.height ?? 240 },
      );
      setGeometry({ target: box, card: position });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    next.current?.focus({ preventScroll: true });
    const observer = new ResizeObserver(schedule);
    if (target) observer.observe(target);
    if (card.current) observer.observe(card.current);
    const mutations = new MutationObserver(() => {
      if (!findTarget(root, steps[index].selector)) {
        const available = steps.filter((step) => findTarget(root, step.selector));
        setSteps(available.length ? available : null);
        setIndex(Math.min(index, Math.max(0, available.length - 1)));
      } else schedule();
    });
    if (root) mutations.observe(root, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [steps, index, scope]);

  const step = steps?.[index];
  return (
    <>
      <Button
        type="button"
        className="page-tour-help"
        variant="ghost"
        onClick={begin}
        aria-label={t('Page guide')}
        title={t('Page guide')}
      >
        <CircleHelp size={17} />
        <span>{t('Page guide')}</span>
      </Button>
      {steps &&
        step &&
        createPortal(
          <dialog
            ref={dialog}
            data-onboarding-dialog
            aria-label={t('Page walkthrough')}
            aria-describedby={`${uid}-description`}
            className="page-tour-dialog"
            onCancel={(event) => {
              event.preventDefault();
              finish('skipped');
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                index < steps.length - 1 ? setIndex(index + 1) : finish('completed');
              }
              if (event.key === 'ArrowLeft' && index > 0) {
                event.preventDefault();
                setIndex(index - 1);
              }
            }}
          >
            <svg className="page-tour-spotlight" aria-hidden="true" width="100%" height="100%">
              <defs>
                <mask id={`${uid}-mask`}>
                  <rect width="100%" height="100%" fill="white" />
                  {geometry && (
                    <rect
                      width={geometry.target.width}
                      height={geometry.target.height}
                      x={geometry.target.left}
                      y={geometry.target.top}
                      rx="10"
                      fill="black"
                    />
                  )}
                </mask>
              </defs>
              <rect
                width="100%"
                height="100%"
                mask={`url(#${uid}-mask)`}
                className="page-tour-dimmer"
              />
              {geometry && (
                <rect
                  x={geometry.target.left}
                  y={geometry.target.top}
                  width={geometry.target.width}
                  height={geometry.target.height}
                  rx="10"
                  className="page-tour-outline"
                />
              )}
            </svg>
            <div
              ref={card}
              className="page-tour-card"
              style={geometry ? geometry.card : { left: 12, top: 12 }}
            >
              <div className="page-tour-meta">
                <span>
                  {t('Step {current} of {total}', { current: index + 1, total: steps.length })}
                </span>
                <button
                  type="button"
                  className="page-tour-close"
                  aria-label={t('Close walkthrough')}
                  onClick={() => finish('skipped')}
                >
                  <X size={18} />
                </button>
              </div>
              <div aria-live="polite" aria-atomic="true">
                <h2>{t(step.title)}</h2>
                <p id={`${uid}-description`}>{t(step.body)}</p>
              </div>
              <div className="page-tour-progress" aria-hidden="true">
                {steps.map((_, i) => (
                  <span key={i} className={i === index ? 'current' : i < index ? 'done' : ''} />
                ))}
              </div>
              <div className="page-tour-actions">
                <button type="button" className="page-tour-skip" onClick={() => finish('skipped')}>
                  {t('Skip tour')}
                </button>
                <div>
                  {index > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={t('Previous step')}
                      onClick={() => setIndex(index - 1)}
                    >
                      <ArrowLeft size={16} />
                    </Button>
                  )}
                  <Button
                    type="button"
                    ref={next}
                    onClick={() =>
                      index < steps.length - 1 ? setIndex(index + 1) : finish('completed')
                    }
                  >
                    {index === steps.length - 1 ? t('Finish tour') : t('Next step')}
                    {index < steps.length - 1 && <ArrowRight size={16} />}
                  </Button>
                </div>
              </div>
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
