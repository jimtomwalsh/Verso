import React from "react";

export interface ModalProps {
  title: React.ReactNode;
  /** Sub-title line under the title. */
  description?: React.ReactNode;
  /** Body content (a field for prompt, a message for confirm). */
  children?: React.ReactNode;
  /** Right-aligned footer actions (Buttons). */
  footer?: React.ReactNode;
  /** Dialog width in px. Default 380. */
  width?: number;
  /** Close on scrim click / × press. */
  onClose?: () => void;
  style?: React.CSSProperties;
}

/** Canonical dialog shell — the promptModal / confirmModal replacement for raw window.prompt/confirm. */
export function Modal(props: ModalProps): JSX.Element;
