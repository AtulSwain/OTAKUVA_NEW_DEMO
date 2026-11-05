"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Bug,
  Copyright,
  EyeOff,
  FileWarning,
  HelpCircle,
  Link2Off,
  Megaphone,
  ShieldAlert,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import {
  CORRECTION_FIELDS,
  REPORT_CATEGORIES,
  type ReportCategory,
  type ReportCategoryId,
} from "../../lib/reports/reportCategories";
import styles from "./report-content.module.css";

/**
 * Report (2026-11-05, owner): "when someone clicks Report, give them every
 * category". Step 1 = pick what's wrong (tiles); step 2 = where it is (a
 * pasted link, or the item a Report button sent) + details.
 *   Wrong information → POST /api/corrections (data team)
 *   everything else   → POST /api/reports (moderators)
 * Both land in Control Center → Reports inbox.
 */

const ICONS: Record<ReportCategoryId, LucideIcon> = {
  WRONG_INFO: FileWarning,
  MISINFORMATION: AlertTriangle,
  SPAM: Megaphone,
  HARASSMENT: ShieldAlert,
  HATE: Ban,
  EXPLICIT: EyeOff,
  SPOILER: EyeOff,
  PIRACY: Link2Off,
  IMPERSONATION: UserX,
  COPYRIGHT: Copyright,
  BROKEN: Bug,
  OTHER: HelpCircle,
};

// What an in-page Report button can point at (?targetType=…&targetId=…).
const PRESET_TYPES: Record<string, string> = {
  DISCUSSION: "a discussion",
  COMMENT: "a comment",
  MESSAGE: "a community chat message",
  USER: "a member’s profile",
  COMMUNITY: "a community",
  ARTICLE: "an article",
  ARTICLE_COMMENT: "an article comment",
};

function ReportForm() {
  const { user, openAuthModal } = useAuth();
  const params = useSearchParams();
  const presetType = params?.get("targetType")?.toUpperCase() ?? null;
  const presetId = params?.get("targetId") ?? null;
  const preset =
    presetType && presetId && PRESET_TYPES[presetType]
      ? { type: presetType, id: presetId }
      : null;
  const startCategory =
    REPORT_CATEGORIES.find((c) => c.id === params?.get("category")) ?? null;

  const [category, setCategory] = useState<ReportCategory | null>(
    startCategory,
  );
  const [link, setLink] = useState(params?.get("link") ?? "");
  const [field, setField] = useState<string>(CORRECTION_FIELDS[0]);
  const [correct, setCorrect] = useState("");
  const [source, setSource] = useState("");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  const categories = preset
    ? REPORT_CATEGORIES.filter((c) => c.kind === "report")
    : REPORT_CATEGORIES;

  if (state === "done") {
    return (
      <div className={styles.messageSuccess}>
        {message}{" "}
        <button
          type="button"
          className={styles.inlineBtn}
          onClick={() => {
            setState("idle");
            setCategory(null);
            setCorrect("");
            setDetails("");
            setSource("");
          }}
        >
          Report something else
        </button>
      </div>
    );
  }

  if (!category) {
    return (
      <div className={styles.form}>
        {preset && (
          <div className={styles.contextBanner}>
            Reporting <strong>{PRESET_TYPES[preset.type]}</strong>. What’s wrong
            with it?
          </div>
        )}
        <div className={styles.categoryGrid} role="list">
          {categories.map((c) => {
            const Icon = ICONS[c.id];
            return (
              <button
                key={c.id}
                type="button"
                role="listitem"
                className={styles.categoryTile}
                onClick={() => setCategory(c)}
              >
                <span className={styles.categoryIcon} aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className={styles.categoryText}>
                  <strong>{c.label}</strong>
                  <span>{c.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const isCorrection = category.kind === "correction";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    try {
      const res = isCorrection
        ? await fetch("/api/corrections", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              link,
              field,
              suggestedValue: correct,
              details,
              source,
            }),
          })
        : await fetch("/api/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(preset
                ? { targetType: preset.type, targetId: preset.id }
                : { link }),
              reason: category.reason,
              description: details || undefined,
            }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("error");
        setMessage(data.error || "Could not send it. Please try again.");
        return;
      }
      setState("done");
      setMessage(
        isCorrection
          ? `Thanks — the data team will check${data.about ? ` “${data.about}”` : " it"} and fix it if it’s wrong.`
          : data.alreadyReported
            ? "You already reported this — moderators will review it."
            : "Thanks — moderators will review this report.",
      );
    } catch {
      setState("error");
      setMessage(
        "Could not reach the server. Check your connection and try again.",
      );
    }
  };

  const Icon = ICONS[category.id];

  return (
    <form className={styles.form} onSubmit={submit}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => setCategory(null)}
      >
        <ArrowLeft size={14} aria-hidden="true" /> All categories
      </button>
      <div className={styles.chosen}>
        <span className={styles.categoryIcon} aria-hidden="true">
          <Icon size={18} />
        </span>
        <span className={styles.categoryText}>
          <strong>{category.label}</strong>
          <span>{category.hint}</span>
        </span>
      </div>

      {preset ? (
        <div className={styles.contextBanner}>
          Reporting <strong>{PRESET_TYPES[preset.type]}</strong>.
        </div>
      ) : (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="report-link">
            {isCorrection
              ? "Link to the page with the wrong information"
              : "Link to the page, profile or post"}
          </label>
          <input
            id="report-link"
            className={styles.input}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="e.g. https://otakuva-demo.vercel.app/anime/frieren"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
          <span className={styles.hint}>
            Open the page, copy the address from your browser, and paste it
            here.
          </span>
        </div>
      )}

      {isCorrection && (
        <>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="report-field">
              Which detail is wrong?
            </label>
            <select
              id="report-field"
              className={styles.select}
              value={field}
              onChange={(e) => setField(e.target.value)}
            >
              {CORRECTION_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="report-correct">
              What’s the correct information?
            </label>
            <textarea
              id="report-correct"
              className={styles.textarea}
              maxLength={2000}
              value={correct}
              onChange={(e) => setCorrect(e.target.value)}
              placeholder="e.g. It has 28 episodes, not 24."
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="report-source">
              Source (optional)
            </label>
            <input
              id="report-source"
              className={styles.input}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="A link that shows the right information"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
        </>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="report-details">
          {isCorrection
            ? "Anything else? (optional)"
            : "What happened? (optional)"}
        </label>
        <textarea
          id="report-details"
          className={styles.textarea}
          maxLength={1000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder={
            isCorrection
              ? "Extra context for the data team"
              : "Anything moderators should know"
          }
        />
      </div>

      {state === "error" && (
        <p className={styles.messageError} role="alert">
          {message}
        </p>
      )}

      {!user ? (
        <div className={styles.signInPrompt}>
          <p>
            Sign in to send this — it lets us follow up and keeps out spam
            reports.
          </p>
          <button
            type="button"
            className={styles.signInBtn}
            onClick={() => openAuthModal("login")}
          >
            Sign in
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={
              state === "sending" ||
              (!preset && !link.trim()) ||
              (isCorrection && correct.trim().length < 2)
            }
          >
            {state === "sending"
              ? "Sending…"
              : isCorrection
                ? "Send correction"
                : "Send report"}
          </button>
        </div>
      )}
    </form>
  );
}

export default function ReportContentPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Report</h1>
        <p className={styles.subtitle}>
          Tell us what’s wrong. Reports go to our moderators; wrong anime
          details go to the data team. Read the{" "}
          <Link href="/community-guidelines">Community Guidelines</Link> for
          what isn’t allowed.
        </p>
      </div>

      <Suspense fallback={null}>
        <ReportForm />
      </Suspense>
    </div>
  );
}
