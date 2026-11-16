import { Component, type ReactNode } from 'react';
import { PageFailure } from './page.tsx';

type PageBoundaryProps = { children: ReactNode };

type PageBoundaryState = { failed: boolean };

export const PAGE_FAILED = 'This page could not be shown. Reload to try again.';

export class PageBoundary extends Component<PageBoundaryProps, PageBoundaryState> {
  override state: PageBoundaryState = { failed: false };

  static getDerivedStateFromError = (): PageBoundaryState => ({ failed: true });

  override render() {
    return this.state.failed ? <PageFailure message={PAGE_FAILED} /> : this.props.children;
  }
}
