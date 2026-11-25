export interface ContentDraft { title: string; slug: string; excerpt: string; content: string; }
export interface ArticleVersion { targetKey: string; locale: string; slug: string; title: string; url: string; }
export interface ArticleSummary {
  slug: string; title: string; description: string; url: string;
  sourceSlug?: string; articleKey?: string; seoTitle?: string; primaryKeyword?: string; takeaway?: string; imageAlt?: string;
  versions?: ArticleVersion[];
}
export interface RepoTarget { key: string; label: string; url: string; locale: string; contentPath: string; additionalPaths?: string[]; deployment?: string; }
export interface SourceChange { relativePath: string; before: string; after: string; articleUrl: string; additionalChanges?: { relativePath: string; before: string; after: string }[]; }
export interface GitAdapter {
  id: string;
  targets: RepoTarget[];
  list(root: string, targetKey: string): Promise<ArticleSummary[]>;
  prepare(root: string, targetKey: string, draft: ContentDraft, metadata: Record<string, unknown>): Promise<SourceChange>;
}
