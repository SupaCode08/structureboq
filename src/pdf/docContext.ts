import { createContext, useContext } from 'react';

/**
 * Where source pages come from: rendered in the browser from the loaded PDF (default,
 * no server needed) or, for the optional Node server, a server document id.
 */
export interface DocSource {
  pageUrl?: (page: number, dpi: number) => Promise<string>;
  docId?: string;
}

export const DocSourceContext = createContext<DocSource>({});
export const useDocSource = () => useContext(DocSourceContext);
