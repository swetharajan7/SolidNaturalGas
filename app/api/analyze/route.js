export async function POST(request) {
  try {
    const { hypothesis } = await request.json();

    const response = await fetch(
      `${process.env.NEBIUS_BASE_URL}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.NEBIUS_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.NEBIUS_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are an LNG market analyst. Evaluate the user's market hypothesis. Return: primary thesis, counter-thesis, evidence required, key variables to monitor, and uncertainty/confidence."
            },
            {
              role: "user",
              content: hypothesis
            }
          ]
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return Response.json(
        { error: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();

    return Response.json({
      result: data.choices?.[0]?.message?.content ?? "No response returned."
    });

  } catch (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
