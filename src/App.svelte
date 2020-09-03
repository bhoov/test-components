<script>
  import Attention from "diy-attention";

  function randomArr(length) {
    return Array.from(Array(length)).map((x) => Math.random());
  }

  let tokens = ["Hello", "world", "."];
  let tokensTarget = ["What", "is", "the", "meaning", "of", "life", "?"]; // If not provided, defaults to `tokens`
  let attentions = tokens.map((t) => randomArr(tokensTarget.length)); // Matrix of shape (nTokens, nTokensTarget)


  let attProps = {
    tokens,
    tokensTarget,
    attentions,
  };
</script>

<h1>Svelte App</h1>
<Attention {...attProps} />

<h1>Web Component</h1>
