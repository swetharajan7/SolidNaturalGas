export async function POST(request) {
  try {
    const { hypothesis } = await request.json();

    if (!hypothesis) {
      return Response.json(
        { error: "Please enter a market hypothesis." },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${process.env.NEBIUS_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.NEBIUS_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are a natural gas and LNG market analyst. Evaluate the user's hypothesis. Give a primary thesis, counter-thesis, evidence needed, key variables to monitor, and a confidence assessment. Clearly distinguish facts from assumptions."
            },
            {
              role: "user",
              content: hypothesis
            }
          ],
          max_tokens: 800
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(data);
      return Response.json(
        { error: "Nebius inference request failed.", details: data },
        { status: response.status }
      );
    }

    return Response.json({
      result: data.choices?.[0]?.message?.content
    });

  } catch (error) {
    console.error(error);

    return Response.json(
      { error: "Unable to analyze hypothesis." },
      { status: 500 }
    );
  }
}
