export async function GET() {
  try {
    /*
     * STEP 1
     * Search the live web for today's Henry Hub spot price.
     */

    const tavilyResponse = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: "Henry Hub natural gas spot price today $/MMBtu",
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
        include_raw_content: false
      })
    });

    const tavilyData = await tavilyResponse.json();

    if (!tavilyResponse.ok) {
      console.error("Tavily error:", tavilyData);
      return Response.json(
        { error: "Live price search failed.", details: tavilyData },
        { status: tavilyResponse.status }
      );
    }

    const evidenceText = (tavilyData.results || [])
      .map((r, i) => `SOURCE ${i + 1}\nTitle: ${r.title}\nContent: ${r.content}\nURL: ${r.url}`)
      .join("\n\n");

    /*
     * STEP 2
     * Ask Nemotron to extract a clean price + date from the evidence.
     */

    const nemotronResponse = await fetch(
      `${process.env.NEBIUS_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.NEBIUS_MODEL,
          messages: [
            {
              role: "system",
              content: `You extract the current Henry Hub natural gas spot price from
search evidence. Respond with ONLY a JSON object, no markdown, no preamble:
{"value": <number, USD per MMBtu>, "date": "<date as stated in the source, e.g. 'Sep 17, 2026'>"}
If no reliable price is found in the evidence, respond with:
{"value": null, "date": null}`
            },
            {
              role: "user",
              content: `Evidence:\n\n${evidenceText}\n\nExtract the price.`
            }
          ],
          max_tokens: 150,
          temperature: 0
        })
      }
    );

    const nemotronData = await nemotronResponse.json();

    if (!nemotronResponse.ok) {
      console.error("Nebius error:", nemotronData);
      return Response.json(
        { error: "Price extraction failed.", details: nemotronData },
        { status: nemotronResponse.status }
      );
    }

    const raw = nemotronData.choices?.[0]?.message?.content || "";
    const clean = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      return Response.json(
        { error: "Unable to parse price from evidence.", details: raw },
        { status: 502 }
      );
    }

    if (parsed.value == null) {
      return Response.json(
        { error: "No reliable Henry Hub price found in current evidence." },
        { status: 404 }
      );
    }

    /*
     * STEP 3
     * Return in the same shape the frontend already expects.
     */

    return Response.json({
      series: [{ date: parsed.date, value: Number(parsed.value) }]
    });

  } catch (error) {
    console.error("Henry Hub route error:", error);
    return Response.json(
      { error: "Unable to load Henry Hub data.", details: error.message },
      { status: 500 }
    );
  }
}

export const revalidate = 3600;
