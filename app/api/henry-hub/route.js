export async function GET() {
  try {
    const url =
      `https://api.eia.gov/v2/natural-gas/pri/fut/data/` +
      `?api_key=${process.env.EIA_API_KEY}` +
      `&frequency=daily` +
      `&data[0]=value` +
      `&facets[series][]=RNGWHHD` +
      `&sort[0][column]=period` +
      `&sort[0][direction]=desc` +
      `&length=30`;

    const response = await fetch(url, {
      cache: "no-store"
    });

    const data = await response.json();

    if (!response.ok) {
      return Response.json(
        { error: "EIA request failed.", details: data },
        { status: response.status }
      );
    }

    const rows = data?.response?.data || [];

    return Response.json({
      series: rows.map((row) => ({
        date: row.period,
        value: Number(row.value)
      }))
    });
  } catch (error) {
    return Response.json(
      {
        error: "Unable to load Henry Hub data.",
        details: error.message
      },
      { status: 500 }
    );
  }
}
