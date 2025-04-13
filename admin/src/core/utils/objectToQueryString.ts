const objectToQueryString = (obj: Record<string, any>): string => {
  const validEntries = Object.entries(obj).filter(
    ([_, value]) => value !== undefined && value !== null
  );
  const queryParams = validEntries.map(
    ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
  ).join('&');
  return queryParams.length > 0 ? `?${queryParams}` : '';
}


export { objectToQueryString };