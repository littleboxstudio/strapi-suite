import { useIntl } from 'react-intl';
import { Dots, Flex, NextLink, PageLink, Pagination, PreviousLink } from '@strapi/design-system';
import { getTranslation } from '../../core/utils/getTranslation';
import { pageWindow } from '../utils/pagination';

type Props = { page: number; pageCount: number; onChange: (page: number) => void };

/** Right-aligned page links; renders nothing for a single page. */
const ListPagination = ({ page, pageCount, onChange }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  if (pageCount <= 1) return null;

  const linkProps = (target: number) => ({
    href: '#',
    onClick: (e: React.MouseEvent) => {
      e.preventDefault();
      onChange(target);
    },
  });

  return (
    <Flex justifyContent="flex-end">
      <Pagination activePage={page} pageCount={pageCount}>
        <PreviousLink {...linkProps(Math.max(1, page - 1))}>
          {t('ecommerce.pagination.previous')}
        </PreviousLink>
        {pageWindow(page, pageCount).map((p, i) =>
          p === null ? (
            <Dots key={`dots-${i}`} />
          ) : (
            <PageLink key={p} number={p} {...linkProps(p)}>
              {t('ecommerce.pagination.goTo', { page: p })}
            </PageLink>
          )
        )}
        <NextLink {...linkProps(Math.min(pageCount, page + 1))}>
          {t('ecommerce.pagination.next')}
        </NextLink>
      </Pagination>
    </Flex>
  );
};

export default ListPagination;
