import { getDocByPath, getDocSlugs, getAdjacentDocs, getRelatedDocs } from '@/utils/docs';
import { extractHeadings } from '@/utils/extract-headings';
import Markdown from '@/components/Markdown';
import { formatDate } from '@/utils/date-formatter';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export async function generateStaticParams() {
  try {
    const slugs = await getDocSlugs();
    const params = [];

    for (const slug of slugs) {
      params.push({ slug });

      if (slug[slug.length - 1] === 'index') {
        const categorySlug = slug.slice(0, -1);
        if (categorySlug.length > 0) {
          params.push({ slug: categorySlug });
        }
      }
    }

    return params;
  } catch (error) {
    console.error('Error generating static params:', error);
    return [];
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  try {
    const { slug } = await params;
    const doc = await getDocByPath(slug) as any;

    if (!doc) {
      return { title: 'Page Not Found', description: 'The requested documentation page could not be found.' };
    }

    return {
      title: `${doc.title} | Pulsar Docs`,
      description: doc.description,
      openGraph: {
        title: doc.title,
        description: doc.description,
        type: 'article',
        modifiedTime: doc.lastUpdated,
        tags: doc.tags,
      },
    };
  } catch {
    return { title: 'Error', description: 'There was an error loading this page' };
  }
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  try {
    const { slug } = await params;
    const doc = await getDocByPath(slug) as any;

    if (!doc) notFound();

    const headings = extractHeadings(doc.content);
    const { prev, next } = await getAdjacentDocs(slug) as any;
    const related = await getRelatedDocs(doc, 3) as any;

    return (
      <div className="doc-page">
        <article className="doc-content max-w-4xl">
          <header className="mb-8">
            <h1 className="text-4xl font-bold mb-4">{doc.title}</h1>

            {doc.description && (
              <p className="text-xl text-gray-400 mb-4">{doc.description}</p>
            )}

            <div className="flex items-center gap-4 text-sm text-gray-400 border-b border-gray-700 pb-4">
              <span>Updated {formatDate(doc.lastUpdated)}</span>
              <span>•</span>
              <span>{doc.readingTime} min read</span>
              {doc.tags && doc.tags.length > 0 && (
                <>
                  <span>•</span>
                  <div className="flex gap-2">
                    {doc.tags.slice(0, 3).map((tag: string) => (
                      <span key={tag} className="px-2 py-1 bg-gray-800 rounded text-xs">{tag}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </header>

          <div className="mb-6">
            <Link
              href={`https://github.com/Far-Beyond-Pulsar/docs/edit/main/public/docs/${slug.join('/')}.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-blue-400 hover:underline"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
              </svg>
              Edit this page on GitHub
            </Link>
          </div>

          <div className="prose prose-lg max-w-none">
            <Markdown content={doc.content} />
          </div>

          {related.length > 0 && (
            <div className="mt-12 pt-8 border-t border-gray-700">
              <h2 className="text-2xl font-bold mb-4">Related Documentation</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {related.map((relatedDoc: any) => (
                  <Link
                    key={relatedDoc.slug}
                    href={`/${relatedDoc.slug}`}
                    className="block p-4 border border-gray-700 rounded-lg hover:border-blue-500 transition-colors"
                  >
                    <h3 className="font-semibold mb-2">{relatedDoc.title}</h3>
                    <p className="text-sm text-gray-400 line-clamp-2">{relatedDoc.description}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <nav className="mt-12 pt-8 border-t border-gray-700 flex justify-between">
            {prev ? (
              <Link href={`/${prev.slug}`} className="flex items-center gap-2 text-blue-400 hover:underline">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <div>
                  <div className="text-sm text-gray-400">Previous</div>
                  <div className="font-semibold">{prev.title}</div>
                </div>
              </Link>
            ) : (
              <div />
            )}

            {next && (
              <Link href={`/${next.slug}`} className="flex items-center gap-2 text-blue-400 hover:underline text-right">
                <div>
                  <div className="text-sm text-gray-400">Next</div>
                  <div className="font-semibold">{next.title}</div>
                </div>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            )}
          </nav>
        </article>

        <div id="toc-data" data-headings={JSON.stringify(headings)} className="hidden" />
      </div>
    );
  } catch (error) {
    console.error('Error rendering doc page:', error);
    return (
      <div className="max-w-4xl mx-auto text-center py-12">
        <h1 className="text-3xl font-bold text-red-600 mb-4">Error Loading Documentation</h1>
        <p className="mb-6">Sorry, we couldn't load this page. Please try again later.</p>
        <Link href="/" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          Return to Docs Home
        </Link>
      </div>
    );
  }
}
