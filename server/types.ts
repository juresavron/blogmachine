export type Site = {
  id: string;
  name: string;
  url: string;
  platform: 'demo' | 'wordpress' | 'manual';
  searchConsoleProperty: string;
  credentialKey: string;
  createdAt: string;
};

export type Post = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  status: 'draft' | 'published';
  siteIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type Publication = {
  id: string;
  postId: string;
  siteId: string;
  url: string;
  status: 'published' | 'failed';
  mode: 'demo' | 'live';
  error: string | null;
  publishedAt: string;
  indexingStatus: 'not_inspected' | 'indexed' | 'not_indexed' | 'inspection_failed';
  lastInspectedAt: string | null;
  remoteId?: number;
  createOutcomeUnknown?: boolean;
};
