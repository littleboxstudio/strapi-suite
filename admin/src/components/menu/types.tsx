export type Item = {
  id: number;
  title: string;
  order: number;
  target: string;
  url?: string;
  contentId?: string;
  contentModel?: string;
  metadata?: Record<string, any>;
  children: Item[];
  selected: boolean;
};

export type RequestEditInput = {
  uid: string;
  title: string;
  children: RequestEditChildInput[];
};

export type RequestEditChildInput = {
  title: string;
  order: number;
  target: string;
  url?: string;
  contentId?: string;
  contentModel?: string;
  metadata?: Record<string, any>;
  children: RequestEditChildInput[];
};
